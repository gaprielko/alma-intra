import type { NotificationKind } from '@intra/shared/schemas';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import { notifications } from '../db/schema/index.js';

const LIMIT = 30;

/** Tells one colleague about something; nobody to tell (no sender, no owner) is fine. */
export async function notify(
  db: Db | Tx,
  values: {
    userId: string | null;
    kind: NotificationKind;
    refId: string;
    customerId: string | null;
    subject: string | null;
  },
) {
  if (!values.userId) return;
  await db.insert(notifications).values({ ...values, userId: values.userId });
}

/** The newest notifications of one colleague and how many are unread. */
export async function listNotifications(db: Db, userId: string) {
  const [items, [counts]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        refId: notifications.refId,
        customerId: notifications.customerId,
        customerName: sql<string | null>`(select c.name from customers c
          where c.id = ${notifications.customerId})`,
        subject: notifications.subject,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(LIMIT),
    db
      .select({ unread: sql<number>`count(*)`.mapWith(Number) })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items, unread: counts?.unread ?? 0 };
}

/** Marks one's own notifications read: the listed ones, or all. */
export async function markRead(db: Db, userId: string, ids: string[] | undefined) {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ...(ids ? [inArray(notifications.id, ids)] : []),
      ),
    )
    .returning({ id: notifications.id });
  return { count: rows.length };
}
