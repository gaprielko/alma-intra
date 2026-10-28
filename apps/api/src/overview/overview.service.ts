import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { listCampaigns } from '../campaigns/campaigns.service.js';
import { LAST_CONTACT } from '../customers/customers.service.js';
import type { Db } from '../db/db.module.js';
import { contactTypes, customers, inboundMessages } from '../db/schema/index.js';

/** A contact of mine with no contact for this long shows on the dashboard. */
export const STALE_DAYS = 30;

/**
 * Prehľad (D-15): the customers by sales status, the latest e-mails sent and how they did, the
 * received e-mails waiting for a contact, and my contacts nobody has been in touch with lately.
 * „Moje ďalšie kroky“ and the scheduled sends come from their own queries.
 */
export async function overviewSummary(db: Db, userId: string) {
  const [statusRows, [unassigned], campaigns, stale] = await Promise.all([
    db
      .select({ status: customers.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(customers)
      .innerJoin(contactTypes, eq(contactTypes.id, customers.contactTypeId))
      .where(and(isNull(customers.deletedAt), eq(contactTypes.systemKey, 'customer')))
      .groupBy(customers.status),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(inboundMessages)
      .where(eq(inboundMessages.status, 'unassigned')),
    listCampaigns(db, 'sent', 1),
    db
      .select({
        id: customers.id,
        name: customers.name,
        city: customers.city,
        lastContactAt: sql<string | null>`${LAST_CONTACT}`,
      })
      .from(customers)
      .where(
        and(
          isNull(customers.deletedAt),
          eq(customers.ownerUserId, userId),
          sql`coalesce(${LAST_CONTACT}, '-infinity') < now() - make_interval(days => ${STALE_DAYS})`,
        ),
      )
      .orderBy(sql`${LAST_CONTACT} asc nulls first`, asc(customers.name))
      .limit(8),
  ]);
  const recent = campaigns.items.slice(0, 5);
  const replies = recent.length
    ? await db
        .select({
          campaignId: sql<string>`m.campaign_id`,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(inboundMessages)
        .innerJoin(sql`campaign_messages m`, sql`m.id = ${inboundMessages.messageId}`)
        .where(
          and(
            sql`m.campaign_id in (${sql.join(
              recent.map((c) => sql`${c.id}`),
              sql`, `,
            )})`,
            sql`${inboundMessages.status} <> 'discarded'`,
          ),
        )
        .groupBy(sql`m.campaign_id`)
    : [];
  const repliesOf = new Map(replies.map((r) => [r.campaignId, r.count]));
  return {
    statuses: Object.fromEntries(statusRows.map((r) => [r.status ?? 'none', r.count])) as Record<
      string,
      number
    >,
    unassignedReplies: unassigned?.count ?? 0,
    recentCampaigns: recent.map((c) => ({
      id: c.id,
      subject: c.subjectText,
      sentAt: c.sentAt,
      status: c.status,
      recipients: c.recipients,
      delivered: c.delivered,
      bounced: c.bounced,
      replies: repliesOf.get(c.id) ?? 0,
    })),
    staleContacts: stale,
    staleDays: STALE_DAYS,
  };
}
