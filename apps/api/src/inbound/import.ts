import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import type { Db, Tx } from '../db/db.module.js';
import { getLook } from '../email/templates.service.js';
import {
  campaignMessages,
  campaigns,
  inboundMessages,
  organizations,
  users,
} from '../db/schema/index.js';
import { importKey, readForward } from './forwarded.js';
import { InboundError } from './inbound-error.js';
import { bySender, parseAddress } from './inbound.js';

/**
 * „Pridaj do konverzácie“ (docs/email-import.md): a received e-mail a user forwarded to Intra is, at
 * their request, stored as the original it carries, received or sent, as if it had gone through
 * Intra. Nothing happens to an e-mail until someone asks, and nothing is ever sent.
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

/** The addresses Alma itself writes from: the sender of its e-mails and the company mailbox. */
async function companyAddresses(db: Db) {
  const look = await getLook(db);
  return [loadEnv().CAMPAIGN_FROM_ADDRESS, look.replyToAddress, look.footerEmail]
    .filter(Boolean)
    .map((address) => address.toLowerCase());
}

/**
 * The colleague who wrote the original, by their login or a private address listed in „Môj účet“.
 * Written from the company's own address, or from the address it was forwarded from, it is the
 * user's who adds it, when no colleague has that address. Null: someone else wrote it.
 */
async function authorOf(db: Db, email: string, forwarder: string, userId: string) {
  const company = await companyAddresses(db);
  const [user] = await db
    .select({ id: users.id, email: users.email, addresses: users.importAddresses })
    .from(users)
    .where(
      sql`(lower(${users.email}) = ${email} or ${users.importAddresses} @> ${JSON.stringify([email])}::jsonb)
        and ${users.status} = 'active'`,
    )
    .limit(1);
  if (user) {
    return {
      id: user.id,
      addresses: [user.email.toLowerCase(), ...user.addresses, forwarder, ...company],
    };
  }
  return email === forwarder || company.includes(email)
    ? { id: userId, addresses: [forwarder, ...company] }
    : null;
}

/** What a forward holds and where it belongs; refused when it holds nothing to add. */
async function planImport(db: Db, id: string, userId: string) {
  const [row] = await db
    .select()
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, id), ne(inboundMessages.status, 'discarded')));
  if (!row) throw new InboundError('NOT_FOUND');
  if (row.importKey) throw new InboundError('ALREADY_IMPORTED');
  const original = readForward(row);
  if (!original) throw new InboundError('NOT_A_FORWARD');

  const from = parseAddress(original.from);
  const key = importKey(original, from.email);
  const [same] = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(eq(inboundMessages.importKey, key));
  if (same) throw new InboundError('ALREADY_IMPORTED');

  // Filed by hand before it was added, the choice stands when the addresses tell nothing.
  const filedByHand =
    row.assignedByUserId && row.organizationId
      ? { customerId: row.organizationId, contactId: row.contactId }
      : null;
  const author = await authorOf(db, from.email, row.fromEmail, userId);
  if (!author) {
    const match = (await bySender(db, from.email)) ?? filedByHand;
    return { row, original, from, key, author, match, recipients: [] };
  }

  // The user's own: to everyone it went to who is known.
  const recipients: Parameters<typeof recordSentImport>[1]['recipients'] = [];
  const addressed = [...original.to, ...original.cc]
    .map((a) => parseAddress(a))
    .filter((a) => !author.addresses.includes(a.email));
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
  if (recipients.length === 0 && filedByHand) {
    recipients.push({
      organizationId: filedByHand.customerId,
      contactId: filedByHand.contactId,
      email: addressed[0]?.email ?? '',
      name: addressed[0]?.name ?? null,
    });
  }
  return { row, original, from, key, author, match: null, recipients };
}

/** What adding a forward would store, for the user to see before asking for it. Stores nothing. */
export async function previewImport(db: Db, id: string, userId: string) {
  const { original, from, author, match, recipients } = await planImport(db, id, userId);
  const ids = author ? recipients.map((r) => r.organizationId) : match ? [match.customerId] : [];
  const named =
    ids.length > 0
      ? await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, ids))
      : [];
  return {
    direction: author ? ('sent' as const) : ('received' as const),
    fromEmail: from.email,
    fromName: from.name,
    to: original.to,
    cc: original.cc,
    subject: original.subject,
    date: original.date,
    organizations: named.map((o) => o.name),
  };
}

/**
 * Stores a forward as the original it carries, in its own row, with the forward's attachments. Its
 * own e-mail ends up in „Odoslané“ (`sent`), or waits to be filed (`waiting`) when nobody among the
 * recipients is known; anyone else's stays in „Prijaté“ (`received`). Old mail: nobody is told.
 */
export async function importInbound(db: Db, id: string, userId: string) {
  const { row, original, from, key, author, match, recipients } = await planImport(db, id, userId);
  const fields = {
    importKey: key,
    importDirection: author ? ('sent' as const) : ('received' as const),
    importUserId: author?.id ?? userId,
    messageId: null,
    userId: null,
    fromEmail: from.email,
    fromName: from.name,
    toEmails: original.to.map((a) => parseAddress(a).email),
    ccEmails: original.cc.map((a) => parseAddress(a).email),
    subject: original.subject.slice(0, 998),
    html: null,
    text: original.text,
    headerMessageId: null,
    inReplyTo: null,
    references: null,
    receivedAt: original.date,
    readAt: new Date(),
  };

  if (!author) {
    await db
      .update(inboundMessages)
      .set({
        ...fields,
        status: match ? 'assigned' : 'unassigned',
        organizationId: match?.customerId ?? null,
        contactId: match?.contactId ?? null,
      })
      .where(eq(inboundMessages.id, row.id));
    return { outcome: 'received' as const };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(inboundMessages)
      .set({
        ...fields,
        // The row only keeps the attachments and the key once the e-mail is in „Odoslané“.
        status: recipients.length > 0 ? 'discarded' : 'unassigned',
        organizationId: recipients[0]?.organizationId ?? null,
        contactId: null,
      })
      .where(eq(inboundMessages.id, row.id));
    if (recipients.length > 0) {
      await recordSentImport(tx, {
        userId: author.id,
        subject: fields.subject,
        text: original.text,
        date: original.date,
        recipients,
      });
    }
  });
  return { outcome: recipients.length > 0 ? ('sent' as const) : ('waiting' as const) };
}
