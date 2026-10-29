import { NOTIFICATION_KINDS } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customers } from './customers.js';
import { users } from './users.js';

export const notificationKind = pgEnum('notification_kind', NOTIFICATION_KINDS);

/**
 * Something one colleague should see (spec 8): a reply to their e-mail (`refId` the received
 * e-mail), an e-mail of theirs that bounced (`refId` the campaign), a next step of theirs that is
 * due (`refId` the activity). Words are made when shown;
 * the row keeps ids only.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: notificationKind('kind').notNull(),
    refId: uuid('ref_id').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    /** The subject of the e-mail it is about, for the line in the list. */
    subject: text('subject'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);
