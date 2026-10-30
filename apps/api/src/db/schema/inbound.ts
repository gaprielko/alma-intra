import { INBOUND_STATUSES } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { campaignMessages } from './campaigns.js';
import { contacts, organizations } from './customers.js';
import { users } from './users.js';

export const inboundStatus = pgEnum('inbound_status', INBOUND_STATUSES);

/**
 * An e-mail that came back (spec 6.6): a reply to one of ours, matched by its Reply-To token, or
 * other mail to the inbound domain, matched by the sender's address or left „Nepriradené“. Kept
 * as received: the HTML is untrusted and only ever shown in a sandbox without scripts or remote
 * content. Never deleted; a discarded one is only hidden.
 */
export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Resend's id of the received e-mail: a webhook delivered twice stores it once. */
    providerEmailId: text('provider_email_id').notNull().unique(),
    /** Our e-mail it answers, when its token matched. */
    messageId: uuid('message_id').references(() => campaignMessages.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    /** The colleague it is for: the sender of our e-mail. */
    userId: uuid('user_id').references(() => users.id),
    status: inboundStatus('status').notNull(),
    /** NULL: nobody has opened it yet; the team shares one inbox, so one state for all. */
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Imported from a private mailbox (docs/email-import.md): the same original only once. */
    importKey: text('import_key'),
    /** „sent“: the user's own e-mail, on this row only until it is in „Odoslané“. */
    importDirection: text('import_direction', { enum: ['received', 'sent'] }),
    importUserId: uuid('import_user_id').references(() => users.id),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name'),
    toEmails: jsonb('to_emails').$type<string[]>().notNull().default([]),
    ccEmails: jsonb('cc_emails').$type<string[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    html: text('html'),
    text: text('text'),
    /** The `Message-ID`, `In-Reply-To` and `References` headers, for answering in the thread. */
    headerMessageId: text('header_message_id'),
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    /**
     * As the e-mail listed them; once filed under a customer each is saved into its folder
     * (`fileId`) or left out with the reason (`skipped`: a type Files does not take, too big, or
     * bytes that are not what the name says).
     */
    attachments: jsonb('attachments')
      .$type<
        {
          id: string;
          filename: string;
          contentType: string;
          size: number;
          fileId?: string;
          skipped?: 'type' | 'size' | 'content';
        }[]
      >()
      .notNull()
      .default([]),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inbound_messages_organization_idx').on(t.organizationId, t.receivedAt),
    index('inbound_messages_message_idx').on(t.messageId),
    uniqueIndex('inbound_messages_import_key_unique')
      .on(t.importKey)
      .where(sql`${t.importKey} is not null`),
    index('inbound_messages_unassigned_idx')
      .on(t.receivedAt)
      .where(sql`${t.status} = 'unassigned'`),
  ],
);
