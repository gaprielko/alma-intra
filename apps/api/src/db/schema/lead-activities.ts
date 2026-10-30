import { LEAD_ACTIVITY_TYPES } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaignMessages } from './campaigns.js';
import { contacts, organizations, products } from './customers.js';

/** A contact's name with the titles, as `personName` writes it; NULL when no contact is joined. */
export const contactFullName = sql<string | null>`nullif(concat_ws(' ',
  nullif(${contacts.titleBefore}, ''), ${contacts.firstName}, ${contacts.lastName}), '')
  || coalesce(', ' || nullif(${contacts.titleAfter}, ''), '')`;

export const leadActivityType = pgEnum('lead_activity_type', LEAD_ACTIVITY_TYPES);

/**
 * What a customer or a partner did on their own, the main menu's „Aktivity“
 * (docs/activities.md), apart from `activities`, which colleagues write. One row per contact and
 * product while it is alive: a further confirmation moves `lastConfirmedAt`. A private person has
 * no contact. `email` is the address the e-mail went to, as it was then. Soft deleted.
 */
export const leadActivities = pgTable(
  'lead_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: leadActivityType('type').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    campaignMessageId: uuid('campaign_message_id').references(() => campaignMessages.id, {
      onDelete: 'set null',
    }),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('lead_activities_created_idx')
      .on(t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('lead_activities_organization_idx').on(t.organizationId),
    index('lead_activities_contact_idx').on(t.contactId),
    uniqueIndex('lead_activities_one_alive')
      .on(
        t.type,
        t.organizationId,
        sql`coalesce(${t.contactId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.productId,
      )
      .where(sql`${t.deletedAt} is null`),
  ],
);
