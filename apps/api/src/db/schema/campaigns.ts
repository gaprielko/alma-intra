import {
  CAMPAIGN_STATUSES,
  type CustomField,
  type EmailNode,
  MESSAGE_STATUSES,
} from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { contacts, customers } from './customers.js';
import { emailTemplates } from './email.js';
import { files, fileVersions } from './files.js';
import { users } from './users.js';

export const campaignStatus = pgEnum('campaign_status', CAMPAIGN_STATUSES);
export const messageStatus = pgEnum('message_status', MESSAGE_STATUSES);

/**
 * A send (spec 6.5): who sends, from which template, what everybody gets. A draft is saved as the
 * wizard goes and can be finished later. Its content is its own copy: editing it never changes
 * the template.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: campaignStatus('status').notNull().default('draft'),
    templateId: uuid('template_id').references(() => emailTemplates.id),
    subject: jsonb('subject').$type<EmailNode>(),
    body: jsonb('body').$type<EmailNode>(),
    customFields: jsonb('custom_fields').$type<CustomField[]>().notNull().default([]),
    commonValues: jsonb('common_values').$type<Record<string, string>>().notNull().default({}),
    /** The plain subject as sent, for the lists (variables shown by name). */
    subjectText: text('subject_text'),
    senderUserId: uuid('sender_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('campaigns_status_idx').on(t.status, t.updatedAt)],
);

/** The files everybody gets; their current version is taken when the e-mails are queued. */
export const campaignAttachments = pgTable(
  'campaign_attachments',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.fileId] })],
);

/**
 * One recipient's e-mail. While a draft, their own values, files and text; once queued, the exact
 * copy they get (subject, HTML, text) and the versions of its attachments, so it is always clear
 * what the customer received (spec 6.5). A private person has no contact: the customer is the
 * recipient. The row is also the queue: `nextAttemptAt` and `leasedUntil` drive the worker.
 */
export const campaignMessages = pgTable(
  'campaign_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    position: integer('position').notNull().default(0),
    values: jsonb('values').$type<Record<string, string>>().notNull().default({}),
    ownFileIds: jsonb('own_file_ids').$type<string[]>().notNull().default([]),
    bodyOverride: jsonb('body_override').$type<EmailNode>(),
    status: messageStatus('status').notNull().default('draft'),
    skipReason: text('skip_reason'),
    toEmail: text('to_email'),
    toName: text('to_name'),
    subject: text('subject'),
    html: text('html'),
    text: text('text'),
    totalBytes: integer('total_bytes'),
    unsubscribeTokenHash: text('unsubscribe_token_hash'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    complainedAt: timestamp('complained_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaign_messages_campaign_idx').on(t.campaignId, t.position),
    index('campaign_messages_customer_idx').on(t.customerId),
    // The worker's queue: the queued messages, oldest attempt first.
    index('campaign_messages_queue_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'queued'`),
    uniqueIndex('campaign_messages_recipient_unique').on(
      t.campaignId,
      t.customerId,
      sql`coalesce(${t.contactId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    uniqueIndex('campaign_messages_provider_unique')
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    uniqueIndex('campaign_messages_unsubscribe_unique')
      .on(t.unsubscribeTokenHash)
      .where(sql`${t.unsubscribeTokenHash} is not null`),
  ],
);

/** The exact version of each attachment a queued message carries. */
export const messageAttachments = pgTable(
  'message_attachments',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => campaignMessages.id, { onDelete: 'cascade' }),
    fileVersionId: uuid('file_version_id')
      .notNull()
      .references(() => fileVersions.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.fileVersionId] }),
    index('message_attachments_version_idx').on(t.fileVersionId),
  ],
);

/** What Resend reported about a message (signed webhooks): the type and when; no content. */
export const emailEvents = pgTable(
  'email_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').references(() => campaignMessages.id, { onDelete: 'cascade' }),
    providerEventId: text('provider_event_id').notNull().unique(),
    type: text('type').notNull(),
    detail: text('detail'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_events_message_idx').on(t.messageId)],
);
