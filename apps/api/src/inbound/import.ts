import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import {
  campaignMessages,
  campaigns,
  emailLook,
  inboundMessages,
  users,
} from '../db/schema/index.js';
import { importKey, readForward } from './forwarded.js';
import { bySender, type InboundEmail, parseAddress } from './inbound.js';

/**
 * Importing old e-mail (docs/email-import.md): a user forwards it to Intra from one of their private
 * addresses with the agreed line, and it is stored as the original, received or sent by them, as if
 * it had gone through Intra. Only when the setting is on; anything else takes the ordinary way.
 */

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Plain text as paragraphs of HTML, line breaks kept. */
export const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

/**
 * The user's own e-mail, already gone: a campaign of one, nothing in it is queued, so nothing is
 * ever sent. Shown in „Odoslané“ and on the timeline like any other.
 */
export async function recordSentImport(
  tx: Tx,
  input: {
    userId: string;
    subject: string;
    text: string;
    date: Date;
    recipients: {
      organizationId: string;
      contactId: string | null;
      email: string;
      name: string | null;
    }[];
  },
) {
  const [campaign] = await tx
    .insert(campaigns)
    .values({
      status: 'sent',
      subjectText: input.subject,
      senderUserId: input.userId,
      sentAt: input.date,
      createdAt: input.date,
      updatedAt: input.date,
    })
    .returning({ id: campaigns.id });
  await tx.insert(campaignMessages).values(
    input.recipients.map((recipient, position) => ({
      campaignId: campaign!.id,
      organizationId: recipient.organizationId,
      contactId: recipient.contactId,
      position,
      status: 'sent' as const,
      toEmail: recipient.email,
      toName: recipient.name,
      subject: input.subject,
      text: input.text,
      html: `<div style="font:14px/1.5 Arial,sans-serif;color:#1b2424">${paragraphs(input.text)}</div>`,
      queuedAt: input.date,
      sentAt: input.date,
    })),
  );
  return campaign!.id;
}

/**
 * The user the forward is from, when importing is on and the sender is one of their private
 * addresses.
 */
async function importerOf(db: Db, senderEmail: string) {
  const [look] = await db
    .select({ importEnabled: emailLook.importEnabled })
    .from(emailLook)
    .where(eq(emailLook.id, 1));
  if (!look?.importEnabled) return null;
  const [user] = await db
    .select({ id: users.id, addresses: users.importAddresses })
    .from(users)
    .where(
      sql`${users.importAddresses} @> ${JSON.stringify([senderEmail])}::jsonb and ${users.status} = 'active'`,
    )
    .limit(1);
  return user ?? null;
}

/**
 * Takes a forward in as the e-mail it carries. Answers null when it is not one to import (it then
 * goes on as an ordinary received e-mail). The same original forwarded again is stored once: the
 * repeat only leaves a discarded row, so the provider's list does not offer it again.
 */
export async function importForwarded(db: Db, email: InboundEmail) {
  const [known] = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(eq(inboundMessages.providerEmailId, email.providerEmailId));
  if (known) return null;
  const importer = await importerOf(db, parseAddress(email.from).email);
  if (!importer) return null;
  const { original } = readForward(email);
  if (!original) return null;

  const from = parseAddress(original.from);
  const key = importKey(original, from.email);
  const own = from.email && importer.addresses.includes(from.email);
  const base = {
    providerEmailId: email.providerEmailId,
    fromEmail: from.email,
    fromName: from.name,
    toEmails: original.to.map((a) => parseAddress(a).email),
    ccEmails: original.cc.map((a) => parseAddress(a).email),
    subject: original.subject.slice(0, 998),
    text: original.text,
    attachments: email.attachments,
    receivedAt: original.date,
    readAt: new Date(),
    importUserId: importer.id,
  };

  const [same] = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(eq(inboundMessages.importKey, key));
  if (same) {
    await db
      .insert(inboundMessages)
      .values({ ...base, status: 'discarded', attachments: [] })
      .onConflictDoNothing();
    return { id: null, matched: null, repeated: true, userId: null };
  }

  if (!own) {
    const match = await bySender(db, from.email);
    const [row] = await db
      .insert(inboundMessages)
      .values({
        ...base,
        status: match ? 'assigned' : 'unassigned',
        organizationId: match?.customerId ?? null,
        contactId: match?.contactId ?? null,
        importKey: key,
        importDirection: 'received',
      })
      .onConflictDoNothing()
      .returning({ id: inboundMessages.id });
    if (!row) return { id: null, matched: null, repeated: true, userId: null };
    // Old mail: nobody is told, no copy goes anywhere.
    return {
      id: row.id,
      matched: match ? ('sender' as const) : null,
      repeated: false,
      userId: null,
    };
  }

  // The user's own: to everyone it went to who is known. Nobody known: it waits to be filed.
  const addressed = [...original.to, ...original.cc]
    .map((a) => parseAddress(a))
    .filter((a) => !importer.addresses.includes(a.email));
  const recipients: Parameters<typeof recordSentImport>[1]['recipients'] = [];
  for (const person of addressed) {
    const match = await bySender(db, person.email);
    if (match) {
      recipients.push({
        organizationId: match.customerId,
        contactId: match.contactId,
        email: person.email,
        name: person.name,
      });
    }
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inboundMessages)
      .values({
        ...base,
        // The row only keeps the attachments and the key once the e-mail is in „Odoslané“.
        status: recipients.length > 0 ? 'discarded' : 'unassigned',
        organizationId: recipients[0]?.organizationId ?? null,
        importKey: key,
        importDirection: 'sent',
      })
      .onConflictDoNothing()
      .returning({ id: inboundMessages.id });
    if (!row) return { id: null, matched: null, repeated: true, userId: null };
    if (recipients.length > 0) {
      await recordSentImport(tx, {
        userId: importer.id,
        subject: base.subject,
        text: base.text,
        date: original.date,
        recipients,
      });
    }
    return {
      id: row.id,
      matched: recipients.length > 0 ? ('sender' as const) : null,
      repeated: false,
      userId: null,
    };
  });
}
