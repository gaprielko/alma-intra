import {
  type EmailNode,
  type InboundListInput,
  inboundListSchema,
  PAGE_SIZE,
} from '@intra/shared/schemas';
import { type AnyColumn, and, desc, eq, isNull, ne, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { fileUnder } from '../customers/customers.service.js';
import { campaignMessages, contacts, organizations, inboundMessages } from '../db/schema/index.js';
import { plainOf } from '../email/render.js';
import { notify } from '../notifications/notifications.service.js';
import { recordSentImport } from './import.js';
import { InboundError } from './inbound-error.js';

export { InboundError };

/**
 * A column of the received e-mail inside a subquery, named with its table: unqualified, Postgres
 * takes the subquery's own column of that name (`contact_links.contact_id`, `m.subject`).
 */
const own = (column: string) => sql.raw(`"inbound_messages"."${column}"`);

/** The first characters of the plain text, for a list line. */
const PREVIEW = sql<string>`left(regexp_replace(coalesce(${inboundMessages.text}, ''), '\\s+', ' ', 'g'), 160)`;

const customerName = sql<string | null>`(select c.name from organizations c
  where c.id = ${own('organization_id')})`;

/** The person the e-mail is filed under, as Kontakty names them. */
const contactName = sql<string | null>`(select concat_ws(' ', p.title_before, p.first_name,
  p.last_name, p.title_after) from contacts p where p.id = ${own('contact_id')})`;

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Everything known of an e-mail, for the full-text search: without regard to diacritics. */
const searchable = sql`unaccent(concat_ws(' ', ${inboundMessages.fromEmail},
  ${inboundMessages.fromName}, ${inboundMessages.subject}, ${inboundMessages.text},
  ${customerName}, ${contactName},
  (select string_agg(a ->> 'filename', ' ') from jsonb_array_elements(${inboundMessages.attachments}) a)))`;

/**
 * A conversation, as Gmail groups one: the subject without „Re:“, „Fwd:“ and the like, at the
 * organization the e-mail is filed under (an unfiled one: with its sender).
 */
const subjectKey = (subject: SQL | AnyColumn) =>
  sql`lower(btrim(regexp_replace(coalesce(${subject}, ''), '^\\s*((re|fw|fwd|odp|aw|sv|wg)\\s*(\\[\\d+\\])?\\s*:\\s*)+', '', 'i')))`;
const threadKey = sql`coalesce(${inboundMessages.organizationId}::text, lower(${inboundMessages.fromEmail}))
  || '|' || ${subjectKey(inboundMessages.subject)}`;
/** Sent, or on its way: an answer shows in the conversation the moment it is written. */
const goesOut = sql`(m.sent_at is not null or m.status = 'queued')`;
/** A direct e-mail is one e-mail with a row per recipient: only one of its rows counts. */
const oneOfDirect = sql`(c.kind <> 'direct' or m.position = (select min(o.position)
  from campaign_messages o where o.campaign_id = m.campaign_id
    and o.organization_id = m.organization_id))`;
/** Our e-mails in the same conversation: sent to that organization under the same subject. */
const ourInThread = sql<number>`(select count(*)::int from campaign_messages m
  join campaigns c on c.id = m.campaign_id
  where m.organization_id = ${own('organization_id')} and ${goesOut}
    and ${oneOfDirect}
    and ${subjectKey(sql`m.subject`)} = ${subjectKey(own('subject'))})`;

/**
 * „Prijaté“: one page of conversations, each shown by its newest received e-mail with how many
 * e-mails it holds (ours included), the unassigned first (or only), newest first, and how many
 * wait to be assigned; narrowed by the filters, then searched within them.
 */
export async function listInbound(db: Db, raw: InboundListInput) {
  const input = inboundListSchema.parse(raw);
  const conditions: SQL[] = [
    input.view === 'unassigned'
      ? eq(inboundMessages.status, 'unassigned')
      : ne(inboundMessages.status, 'discarded'),
  ];
  if (input.customerId) {
    conditions.push(sql`(${inboundMessages.organizationId} = ${input.customerId}
      or ${inboundMessages.organizationId} in
        (select e.id from organizations e where e.parent_id = ${input.customerId}))`);
  }
  if (input.contactId) conditions.push(eq(inboundMessages.contactId, input.contactId));
  if (input.withAttachments) {
    conditions.push(sql`jsonb_array_length(${inboundMessages.attachments}) > 0`);
  }
  if (input.search) {
    conditions.push(sql`${searchable} ilike unaccent(${likePattern(input.search)})`);
  }
  const where = and(...conditions);
  // The newest received e-mail of each conversation stands for it.
  const newest = db.$with('newest').as(
    db
      .select({
        id: sql<string>`${inboundMessages.id}`.as('newest_id'),
        rank: sql<number>`row_number() over (partition by ${threadKey}
          order by ${inboundMessages.receivedAt} desc)`.as('newest_rank'),
        received: sql<number>`count(*) over (partition by ${threadKey})`.as('received_in_thread'),
        unread: sql<boolean>`bool_or(${inboundMessages.readAt} is null)
          over (partition by ${threadKey})`.as('unread_in_thread'),
      })
      .from(inboundMessages)
      .where(where),
  );
  const [items, [counts]] = await Promise.all([
    db
      .with(newest)
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
        /** How many e-mails the conversation holds: theirs and ours. */
        inThread: sql<number>`${newest.received} + ${ourInThread}`.mapWith(Number),
        ours: ourInThread.mapWith(Number),
        importDirection: inboundMessages.importDirection,
        /** Any received e-mail of the conversation not opened yet. */
        unread: sql<boolean>`${newest.unread}`,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(inboundMessages)
      .innerJoin(newest, and(eq(newest.id, inboundMessages.id), eq(newest.rank, 1)))
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

/**
 * The rest of an e-mail's conversation (as „Prijaté“ groups it), newest first: the other received
 * e-mails and ours, each with what is needed to show it collapsed and opened.
 */
export async function inboundThread(db: Db, id: string) {
  const [self] = await db
    .select({ organizationId: inboundMessages.organizationId, key: threadKey })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, id), ne(inboundMessages.status, 'discarded')));
  if (!self) throw new InboundError('NOT_FOUND');
  const [received, sent] = await Promise.all([
    db
      .select({
        id: inboundMessages.id,
        fromEmail: inboundMessages.fromEmail,
        fromName: inboundMessages.fromName,
        contactName,
        toEmails: inboundMessages.toEmails,
        at: inboundMessages.receivedAt,
        text: inboundMessages.text,
        attachments: inboundMessages.attachments,
      })
      .from(inboundMessages)
      .where(
        and(
          ne(inboundMessages.id, id),
          ne(inboundMessages.status, 'discarded'),
          sql`${threadKey} = ${self.key}`,
        ),
      ),
    self.organizationId
      ? db.execute<{
          id: string;
          sender: string | null;
          to_name: string | null;
          to_email: string | null;
          at: string;
          text: string | null;
          kind: string;
          body: EmailNode | null;
        }>(sql`select m.id, u.name as sender, m.to_name, m.to_email,
            coalesce(m.sent_at, m.queued_at) as at, m.text, c.kind, c.body
          from campaign_messages m
          join campaigns c on c.id = m.campaign_id
          left join users u on u.id = c.sender_user_id
          where m.organization_id = ${self.organizationId} and ${goesOut}
            and ${oneOfDirect}
            and ${subjectKey(sql`m.subject`)} = split_part(${self.key}, '|', 2)`)
      : Promise.resolve({ rows: [] }),
  ]);
  const items = [
    ...received.map((r) => ({
      kind: 'received' as const,
      id: r.id,
      who: r.contactName ?? r.fromName ?? r.fromEmail,
      email: r.fromEmail,
      to: r.toEmails.join(', '),
      at: new Date(r.at).toISOString(),
      text: r.text ?? '',
      attachments: r.attachments.length,
    })),
    ...sent.rows.map((m) => ({
      kind: 'sent' as const,
      id: m.id,
      who: m.sender ?? '',
      email: null,
      to: m.to_name ?? m.to_email ?? '',
      at: new Date(m.at).toISOString(),
      // A direct e-mail's own words, without the look's header and footer and what it quotes.
      text: m.kind === 'direct' && m.body ? plainOf(m.body, {}, {}) : (m.text ?? ''),
      attachments: 0,
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** How many other conversations of a person „Iné konverzácie“ shows. */
const OTHER_CONVERSATIONS = 20;

/**
 * The other conversations with the person who wrote an e-mail (by the contact it is filed under,
 * else by the sender's address): each by its newest received e-mail, newest first.
 */
export async function otherConversations(db: Db, id: string) {
  const [self] = await db
    .select({
      contactId: inboundMessages.contactId,
      fromEmail: inboundMessages.fromEmail,
      key: threadKey,
    })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, id), ne(inboundMessages.status, 'discarded')));
  if (!self) throw new InboundError('NOT_FOUND');
  const samePerson = self.contactId
    ? eq(inboundMessages.contactId, self.contactId)
    : sql`lower(${inboundMessages.fromEmail}) = lower(${self.fromEmail})`;
  const newest = db.$with('newest').as(
    db
      .select({
        id: sql<string>`${inboundMessages.id}`.as('newest_id'),
        rank: sql<number>`row_number() over (partition by ${threadKey}
          order by ${inboundMessages.receivedAt} desc)`.as('newest_rank'),
        received: sql<number>`count(*) over (partition by ${threadKey})`.as('received_in_thread'),
      })
      .from(inboundMessages)
      .where(
        and(ne(inboundMessages.status, 'discarded'), samePerson, sql`${threadKey} <> ${self.key}`),
      ),
  );
  return db
    .with(newest)
    .select({
      id: inboundMessages.id,
      subject: inboundMessages.subject,
      preview: PREVIEW,
      receivedAt: inboundMessages.receivedAt,
      inThread: sql<number>`${newest.received} + ${ourInThread}`.mapWith(Number),
    })
    .from(inboundMessages)
    .innerJoin(newest, and(eq(newest.id, inboundMessages.id), eq(newest.rank, 1)))
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(OTHER_CONVERSATIONS);
}

/** One received e-mail whole, with whom it is filed under and the e-mail it answers. */
export async function getInbound(db: Db, id: string) {
  const [row] = await db
    .select({
      inbound: inboundMessages,
      customerName,
      contactName,
      /** The person's position at the organization the e-mail is filed under. */
      contactPosition: sql<string | null>`(select l.position from contact_links l
        where l.contact_id = ${own('contact_id')}
          and l.organization_id = ${own('organization_id')})`,
      original: sql<{
        campaignId: string;
        subject: string | null;
        sentAt: string | null;
      } | null>`(select json_build_object('campaignId', m.campaign_id, 'subject', m.subject,
        'sentAt', m.sent_at) from campaign_messages m where m.id = ${own('message_id')})`,
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
      importDirection: inboundMessages.importDirection,
      importUserId: inboundMessages.importUserId,
      toEmails: inboundMessages.toEmails,
      text: inboundMessages.text,
      receivedAt: inboundMessages.receivedAt,
    })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, input.id), ne(inboundMessages.status, 'discarded')));
  if (!before) throw new InboundError('NOT_FOUND');
  // The user's own imported e-mail, waiting for a recipient: filed, it belongs in „Odoslané“.
  if (before.importDirection === 'sent' && before.importUserId) {
    const organizationId = await fileUnder(
      db,
      input.customerId,
      input.contactId ? [input.contactId] : [],
    );
    await db.transaction(async (tx) => {
      await recordSentImport(tx, {
        userId: before.importUserId!,
        subject: before.subject,
        text: before.text ?? '',
        date: before.receivedAt,
        recipients: [
          {
            organizationId,
            contactId: input.contactId,
            email: before.toEmails[0] ?? '',
            name: null,
          },
        ],
      });
      // Discarded here: the row keeps the key and the attachments, the e-mail is in „Odoslané“.
      await tx
        .update(inboundMessages)
        .set({ status: 'discarded', organizationId, assignedByUserId: userId })
        .where(eq(inboundMessages.id, input.id));
    });
    return { before, sent: true };
  }
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
  return { before, sent: false };
}

/**
 * Puts an e-mail aside: it leaves „Prijaté“ and the timeline, and stays in the database. An added
 * one gives up its key, so the same original can be added again.
 */
export async function discardInbound(db: Db, id: string) {
  const rows = await db
    .update(inboundMessages)
    .set({ status: 'discarded', importKey: null })
    .where(and(eq(inboundMessages.id, id), ne(inboundMessages.status, 'discarded')))
    .returning({ customerId: inboundMessages.organizationId });
  if (rows.length === 0) throw new InboundError('NOT_FOUND');
  return rows[0]!;
}

/** The key of the conversation an e-mail is in; refused when it is not there. */
async function threadKeyOf(db: Db, id: string) {
  const [self] = await db
    .select({ key: threadKey })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, id), ne(inboundMessages.status, 'discarded')));
  if (!self) throw new InboundError('NOT_FOUND');
  return self.key as string;
}

/** The whole conversation read (opening it) or unread again (the envelope in its row). */
export async function markInboundRead(db: Db, id: string, read: boolean) {
  const key = await threadKeyOf(db, id);
  await db
    .update(inboundMessages)
    .set({ readAt: read ? new Date() : null })
    .where(and(ne(inboundMessages.status, 'discarded'), sql`${threadKey} = ${key}`));
}

/** „Zahodiť“ in a row: the row stands for its conversation, so all of it goes. */
export async function discardInboundThread(db: Db, id: string) {
  const key = await threadKeyOf(db, id);
  const rows = await db
    .update(inboundMessages)
    .set({ status: 'discarded', importKey: null })
    .where(and(ne(inboundMessages.status, 'discarded'), sql`${threadKey} = ${key}`))
    .returning({ id: inboundMessages.id });
  return { count: rows.length };
}
