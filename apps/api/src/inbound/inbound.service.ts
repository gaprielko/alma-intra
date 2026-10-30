import { type InboundListInput, inboundListSchema, PAGE_SIZE } from '@intra/shared/schemas';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { fileUnder } from '../customers/customers.service.js';
import {
  campaignMessages,
  campaigns,
  contacts,
  organizations,
  inboundMessages,
} from '../db/schema/index.js';
import { notify } from '../notifications/notifications.service.js';

/** A refusal the web words for itself (`sk.inbound.errors`). */
export class InboundError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CUSTOMER_NOT_FOUND' | 'CONTACT_NOT_OF_CUSTOMER') {
    super(code);
  }
}

/** The first characters of the plain text, for a list line. */
const PREVIEW = sql<string>`left(regexp_replace(coalesce(${inboundMessages.text}, ''), '\\s+', ' ', 'g'), 160)`;

const customerName = sql<string | null>`(select c.name from organizations c
  where c.id = ${inboundMessages.organizationId})`;

/** The person the e-mail is filed under, as Kontakty names them. */
const contactName = sql<string | null>`(select concat_ws(' ', p.title_before, p.first_name,
  p.last_name, p.title_after) from contacts p where p.id = ${inboundMessages.contactId})`;

/**
 * „Prijaté“: one page of received e-mail, the unassigned first (or only), newest first, and how
 * many wait to be assigned.
 */
export async function listInbound(db: Db, raw: InboundListInput) {
  const input = inboundListSchema.parse(raw);
  const where =
    input.view === 'unassigned'
      ? eq(inboundMessages.status, 'unassigned')
      : ne(inboundMessages.status, 'discarded');
  const [items, [counts]] = await Promise.all([
    db
      .select({
        id: inboundMessages.id,
        status: inboundMessages.status,
        fromEmail: inboundMessages.fromEmail,
        fromName: inboundMessages.fromName,
        subject: inboundMessages.subject,
        preview: PREVIEW,
        receivedAt: inboundMessages.receivedAt,
        customerId: inboundMessages.organizationId,
        customerName,
        contactName,
        attachmentCount: sql<number>`jsonb_array_length(${inboundMessages.attachments})`,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(inboundMessages)
      .where(where)
      .orderBy(sql`${inboundMessages.status} = 'unassigned' desc`, desc(inboundMessages.receivedAt))
      .limit(PAGE_SIZE)
      .offset((input.page - 1) * PAGE_SIZE),
    db
      .select({
        unassigned:
          sql<number>`count(*) filter (where ${inboundMessages.status} = 'unassigned')`.mapWith(
            Number,
          ),
      })
      .from(inboundMessages),
  ]);
  return {
    items,
    total: items[0]?.total ?? 0,
    page: input.page,
    pageSize: PAGE_SIZE,
    unassigned: counts?.unassigned ?? 0,
  };
}

/** One received e-mail whole, with whom it is filed under and the e-mail it answers. */
export async function getInbound(db: Db, id: string) {
  const [row] = await db
    .select({
      inbound: inboundMessages,
      customerName,
      contactName,
      original: sql<{
        campaignId: string;
        subject: string | null;
        sentAt: string | null;
      } | null>`(select json_build_object('campaignId', m.campaign_id, 'subject', m.subject,
        'sentAt', m.sent_at) from campaign_messages m where m.id = ${inboundMessages.messageId})`,
    })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, id), ne(inboundMessages.status, 'discarded')));
  if (!row) throw new InboundError('NOT_FOUND');
  const { inbound, ...rest } = row;
  const { organizationId, ...fields } = inbound;
  return { ...fields, customerId: organizationId, ...rest };
}

/** Files an e-mail under a customer and optionally one of its live contact persons. */
export async function assignInbound(
  db: Db,
  userId: string,
  input: { id: string; customerId: string; contactId: string | null },
) {
  const [customer] = await db
    .select({ id: organizations.id, ownerUserId: organizations.ownerUserId })
    .from(organizations)
    .where(and(eq(organizations.id, input.customerId), isNull(organizations.deletedAt)));
  if (!customer) throw new InboundError('CUSTOMER_NOT_FOUND');
  if (input.contactId) {
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, input.contactId),
          sql`exists (select 1 from contact_links l where l.contact_id = ${contacts.id} and l.organization_id = ${input.customerId})`,
          isNull(contacts.deletedAt),
        ),
      );
    if (!contact) throw new InboundError('CONTACT_NOT_OF_CUSTOMER');
  }
  const [before] = await db
    .select({
      customerId: inboundMessages.organizationId,
      status: inboundMessages.status,
      subject: inboundMessages.subject,
    })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, input.id), ne(inboundMessages.status, 'discarded')));
  if (!before) throw new InboundError('NOT_FOUND');
  // Another customer than the one the token named: the link to our e-mail no longer holds.
  const [kept] = await db
    .select({ customerId: campaignMessages.organizationId })
    .from(campaignMessages)
    .innerJoin(inboundMessages, eq(inboundMessages.messageId, campaignMessages.id))
    .where(eq(inboundMessages.id, input.id));
  await db
    .update(inboundMessages)
    .set({
      status: 'assigned',
      // Where the person is: a prevádzka when they are only there (P-11).
      organizationId: await fileUnder(
        db,
        input.customerId,
        input.contactId ? [input.contactId] : [],
      ),
      contactId: input.contactId,
      assignedByUserId: userId,
      ...(kept && kept.customerId !== input.customerId ? { messageId: null } : {}),
    })
    .where(eq(inboundMessages.id, input.id));
  // The contact's owner learns of an e-mail that reached their contact, unless they filed it.
  if (before.customerId !== input.customerId && customer.ownerUserId !== userId) {
    await notify(db, {
      userId: customer.ownerUserId,
      kind: 'reply',
      refId: input.id,
      customerId: input.customerId,
      subject: before.subject.slice(0, 200),
    });
  }
  return { before };
}

/** Puts an e-mail aside: it leaves „Prijaté“ and the timeline, and stays in the database. */
export async function discardInbound(db: Db, id: string) {
  const rows = await db
    .update(inboundMessages)
    .set({ status: 'discarded' })
    .where(and(eq(inboundMessages.id, id), ne(inboundMessages.status, 'discarded')))
    .returning({ customerId: inboundMessages.organizationId });
  if (rows.length === 0) throw new InboundError('NOT_FOUND');
  return rows[0]!;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Plain text as paragraphs of HTML, line breaks kept. */
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

/**
 * „Odpovedať“ (spec 6.6): an answer to a received e-mail, queued like any e-mail to a customer (a
 * campaign of one, so it shows in „Odoslané“ and on the timeline), to the sender, with the subject
 * „Re: …“ and the received text quoted below. Correspondence, not marketing: it goes even to a
 * person who unsubscribed (D-14), and the worker threads it instead of adding an unsubscribe link.
 */
export async function replyToInbound(db: Db, userId: string, input: { id: string; text: string }) {
  const [received] = await db
    .select()
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, input.id), eq(inboundMessages.status, 'assigned')));
  if (!received?.organizationId) throw new InboundError('NOT_FOUND');
  const subject = /^re:/i.test(received.subject) ? received.subject : `Re: ${received.subject}`;
  const quoted = received.text?.trim() ?? '';
  const sender = received.fromName
    ? `${received.fromName} <${received.fromEmail}>`
    : received.fromEmail;
  const html =
    `<div style="font:14px/1.5 Arial,sans-serif;color:#1b2424">${paragraphs(input.text)}` +
    (quoted
      ? `<blockquote style="margin:16px 0 0;padding-left:12px;border-left:3px solid #d5dede;color:#5b6b6b">` +
        `<p style="margin:0 0 8px">${escapeHtml(sender)}:</p>${paragraphs(quoted)}</blockquote>`
      : '') +
    `</div>`;
  const text = quoted ? `${input.text}\n\n${sender}:\n${quoted.replace(/^/gm, '> ')}` : input.text;
  return db.transaction(async (tx) => {
    const now = new Date();
    const [campaign] = await tx
      .insert(campaigns)
      .values({ status: 'sending', subjectText: subject, senderUserId: userId, sentAt: now })
      .returning({ id: campaigns.id });
    await tx.insert(campaignMessages).values({
      campaignId: campaign!.id,
      organizationId: received.organizationId!,
      contactId: received.contactId,
      status: 'queued',
      toEmail: received.fromEmail,
      toName: received.fromName,
      subject,
      html,
      text,
      inReplyToInboundId: received.id,
      queuedAt: now,
      nextAttemptAt: now,
    });
    return { campaignId: campaign!.id };
  });
}
