import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { listCampaigns } from '../campaigns/campaigns.service.js';
import { LAST_CONTACT } from '../customers/customers.service.js';
import type { Db } from '../db/db.module.js';
import { campaigns as campaignsTable, organizations, inboundMessages } from '../db/schema/index.js';

/** A contact of mine with no contact for this long shows on the dashboard. */
export const STALE_DAYS = 30;

/**
 * Prehľad (D-15): the organizations by sales status, the latest e-mails sent and how they did, the
 * received e-mails waiting for a contact, the e-mails scheduled to leave, and my contacts nobody
 * has been in touch with lately. „Moje ďalšie kroky“ come from their own query.
 */
export async function overviewSummary(db: Db, userId: string) {
  const [statusRows, [unassigned], campaigns, stale, scheduled] = await Promise.all([
    db
      .select({ status: organizations.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(organizations)
      .where(and(isNull(organizations.deletedAt), eq(organizations.role, 'customer')))
      .groupBy(organizations.status),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(inboundMessages)
      .where(eq(inboundMessages.status, 'unassigned')),
    listCampaigns(db, 'sent', 1),
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        lastContactAt: sql<string | null>`${LAST_CONTACT}`,
      })
      .from(organizations)
      .where(
        and(
          isNull(organizations.deletedAt),
          eq(organizations.ownerUserId, userId),
          sql`coalesce(${LAST_CONTACT}, '-infinity') < now() - make_interval(days => ${STALE_DAYS})`,
        ),
      )
      .orderBy(sql`${LAST_CONTACT} asc nulls first`, asc(organizations.name))
      .limit(8),
    db
      .select({
        id: campaignsTable.id,
        subject: campaignsTable.subjectText,
        scheduledAt: campaignsTable.scheduledAt,
        recipients: sql<number>`(select count(*)::int from campaign_messages m
          where m.campaign_id = ${campaignsTable.id} and m.status = 'queued')`,
      })
      .from(campaignsTable)
      .where(eq(campaignsTable.status, 'scheduled'))
      .orderBy(asc(campaignsTable.scheduledAt))
      .limit(5),
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
    scheduled,
    staleDays: STALE_DAYS,
  };
}
