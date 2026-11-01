import { LEAD_ACTIVITY_SOURCES } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { campaignMessages } from './campaigns.js';
import { contacts, organizations, products } from './customers.js';
import { fileDrafts } from './file-shares.js';

/** A contact's name with the titles, as `personName` writes it; NULL when no contact is joined. */
export const contactFullName = sql<string | null>`nullif(concat_ws(' ',
  nullif(${contacts.titleBefore}, ''), ${contacts.firstName}, ${contacts.lastName}), '')
  || coalesce(', ' || nullif(${contacts.titleAfter}, ''), '')`;

export const leadActivitySource = pgEnum('lead_activity_source', LEAD_ACTIVITY_SOURCES);

/**
 * The code list of Aktivity (docs/activity-types.md). `confirm_label` is the public page's button;
 * NULL on a type no e-mail button can record, which is a podnet.
 */
export const activityTypes = pgTable('activity_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  confirmLabel: text('confirm_label'),
  asksProduct: boolean('asks_product').notNull().default(false),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A podnet as Alma ADOS sent it (docs/activities-from-apps.md). `id` is Alma's. The texts and the
 * picture may hold health data: team only, never in a log, a timeline or a notification.
 */
export const appFeedback = pgTable('app_feedback', {
  id: uuid('id').primaryKey(),
  /** `bug`, `idea` or `question`; kept as sent, the contract is Alma's. */
  kind: text('kind').notNull(),
  whatDoing: text('what_doing').notNull(),
  expected: text('expected').notNull().default(''),
  reporterUserId: uuid('reporter_user_id'),
  reporterName: text('reporter_name').notNull(),
  reporterEmail: text('reporter_email').notNull(),
  reporterRole: text('reporter_role'),
  /** What Alma calls the organization: shown while the entry is not assigned. */
  sourceOrganizationId: uuid('source_organization_id').notNull(),
  sourceOrganizationName: text('source_organization_name'),
  app: jsonb('app').$type<Record<string, unknown>>().notNull(),
  device: jsonb('device').$type<Record<string, unknown>>().notNull(),
  place: jsonb('place').$type<Record<string, unknown> | null>(),
  trail: jsonb('trail').$type<unknown[]>().notNull().default([]),
  apiCalls: jsonb('api_calls').$type<unknown[]>().notNull().default([]),
  errors: jsonb('errors').$type<unknown[]>().notNull().default([]),
  pendingSync: integer('pending_sync'),
  /** The masked picture of the screen in object storage; null without one. */
  screenshotKey: text('screenshot_key'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

/** What the reporter added later: a reply, or an answer to „Funguje to už?“. `id` is Alma's. */
export const appFeedbackEvents = pgTable(
  'app_feedback_events',
  {
    id: uuid('id').primaryKey(),
    feedbackId: uuid('feedback_id')
      .notNull()
      .references(() => appFeedback.id),
    /** `message` or `confirmation`. */
    kind: text('kind').notNull(),
    body: text('body'),
    /** A confirmation's answer; null on a message. */
    works: boolean('works'),
    statusAfter: text('status_after'),
    resolvedEventId: text('resolved_event_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('app_feedback_events_feedback_idx').on(t.feedbackId)],
);

/**
 * What a customer or a partner did on their own, the main menu's „Aktivity“
 * (docs/activities.md), apart from `activities`, which colleagues write. From an e-mail: one row per
 * type, contact and product while it is alive; a further confirmation moves `lastConfirmedAt` and
 * adds to `confirmedCount`. From an application: every podnet is a row of its own, and until it is
 * assigned it has no organization. A private person has no contact. `email` is the address the
 * e-mail went to, or the reporter's. Soft deleted.
 */
export const leadActivities = pgTable(
  'lead_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    typeId: uuid('type_id')
      .notNull()
      .references(() => activityTypes.id),
    source: leadActivitySource('source').notNull().default('email'),
    productId: uuid('product_id').references(() => products.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    campaignMessageId: uuid('campaign_message_id').references(() => campaignMessages.id, {
      onDelete: 'set null',
    }),
    appFeedbackId: uuid('app_feedback_id')
      .references(() => appFeedback.id)
      .unique(),
    /** The draft an outsider sent; the file and all else are read from it. */
    fileDraftId: uuid('file_draft_id').references(() => fileDrafts.id, { onDelete: 'set null' }),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    /** How many times the contact confirmed. Counted from here on: older clicks were not. */
    confirmedCount: integer('confirmed_count').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('lead_activities_created_idx')
      .on(t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('lead_activities_organization_idx').on(t.organizationId),
    index('lead_activities_contact_idx').on(t.contactId),
    uniqueIndex('lead_activities_one_from_email')
      .on(
        t.typeId,
        t.organizationId,
        sql`coalesce(${t.contactId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.deletedAt} is null and ${t.source} = 'email'`),
  ],
);
