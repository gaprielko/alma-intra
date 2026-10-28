import type { CustomerFilter } from '@intra/shared/schemas';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * A saved segment (D-7): the contact list's filters under a name. It keeps the rules, not the
 * contacts, so a new contact that matches belongs to it at once. Personal, or shared with the
 * colleagues; only its author changes or deletes it.
 */
export const segments = pgTable(
  'segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    filters: jsonb('filters').$type<CustomerFilter>().notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    shared: boolean('shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('segments_owner_idx').on(t.ownerUserId)],
);
