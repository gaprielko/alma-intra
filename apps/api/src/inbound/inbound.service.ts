import { type InboundListInput, inboundListSchema, PAGE_SIZE } from '@intra/shared/schemas';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { campaignMessages, contacts, customers, inboundMessages } from '../db/schema/index.js';

/** A refusal the web words for itself (`sk.inbound.errors`). */
export class InboundError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CUSTOMER_NOT_FOUND' | 'CONTACT_NOT_OF_CUSTOMER') {
    super(code);
  }
}

/** The first characters of the plain text, for a list line. */
const PREVIEW = sql<string>`left(regexp_replace(coalesce(${inboundMessages.text}, ''), '\\s+', ' ', 'g'), 160)`;

const customerName = sql<string | null>`(select c.name from customers c
  where c.id = ${inboundMessages.customerId})`;

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
        customerId: inboundMessages.customerId,
        customerName,
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
      contactName: sql<string | null>`(select concat_ws(' ', p.title_before, p.first_name,
        p.last_name) from contacts p where p.id = ${inboundMessages.contactId})`,
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
  return { ...inbound, ...rest };
}

/** Files an e-mail under a customer and optionally one of its live contact persons. */
export async function assignInbound(
  db: Db,
  userId: string,
  input: { id: string; customerId: string; contactId: string | null },
) {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), isNull(customers.deletedAt)));
  if (!customer) throw new InboundError('CUSTOMER_NOT_FOUND');
  if (input.contactId) {
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, input.contactId),
          eq(contacts.customerId, input.customerId),
          isNull(contacts.deletedAt),
        ),
      );
    if (!contact) throw new InboundError('CONTACT_NOT_OF_CUSTOMER');
  }
  const [before] = await db
    .select({ customerId: inboundMessages.customerId, status: inboundMessages.status })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, input.id), ne(inboundMessages.status, 'discarded')));
  if (!before) throw new InboundError('NOT_FOUND');
  // Another customer than the one the token named: the link to our e-mail no longer holds.
  const [kept] = await db
    .select({ customerId: campaignMessages.customerId })
    .from(campaignMessages)
    .innerJoin(inboundMessages, eq(inboundMessages.messageId, campaignMessages.id))
    .where(eq(inboundMessages.id, input.id));
  await db
    .update(inboundMessages)
    .set({
      status: 'assigned',
      customerId: input.customerId,
      contactId: input.contactId,
      assignedByUserId: userId,
      ...(kept && kept.customerId !== input.customerId ? { messageId: null } : {}),
    })
    .where(eq(inboundMessages.id, input.id));
  return { before };
}

/** Puts an e-mail aside: it leaves „Prijaté“ and the timeline, and stays in the database. */
export async function discardInbound(db: Db, id: string) {
  const rows = await db
    .update(inboundMessages)
    .set({ status: 'discarded' })
    .where(and(eq(inboundMessages.id, id), ne(inboundMessages.status, 'discarded')))
    .returning({ customerId: inboundMessages.customerId });
  if (rows.length === 0) throw new InboundError('NOT_FOUND');
  return rows[0]!;
}
