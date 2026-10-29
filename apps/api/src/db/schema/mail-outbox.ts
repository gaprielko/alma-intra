import { sql } from 'drizzle-orm';
import {
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

/** The system e-mails of the app. E-mails to organizations have their own tables. */
export const mailKind = pgEnum('mail_kind', [
  'invitation',
  'password_reset',
  'second_factor_changed',
]);

/** What happened to her second factor; the mail names it, never a secret or a code. */
export const SECOND_FACTOR_CHANGES = ['enabled', 'replaced', 'reset'] as const;
export type SecondFactorChange = (typeof SECOND_FACTOR_CHANGES)[number];

/** Ids only: the recipient, the names and the one-time token are resolved when the mail is sent. */
export type MailOutboxPayload = { userId: string } | { userId: string; change: SecondFactorChange };

/**
 * Transactional outbox for e-mails: the row is written in the transaction of the business change
 * and delivered after commit by the worker in `mail/mail-outbox.ts`. No address, no name, no
 * token, no body.
 *
 * It is also the delivery log: `kind` is the template, the timestamps are the status, and the
 * three columns below say where it went and what the provider answered.
 */
export const mailOutbox = pgTable(
  'mail_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: mailKind('kind').notNull(),
    payload: jsonb('payload').$type<MailOutboxPayload>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    /** Doubles as the lease of the worker that claimed the row. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /**
     * Given up after the last attempt, or at the first one when the provider refused the message
     * for good; somebody should look at the logs.
     */
    failedAt: timestamp('failed_at', { withTimezone: true }),
    /**
     * Nothing to send any more (invitation accepted or withdrawn, user gone), or an address on a
     * reserved domain that is never sent to (then `recipient_masked` is set). Never retried.
     */
    droppedAt: timestamp('dropped_at', { withTimezone: true }),
    /** `e***@example.com`, written when the provider accepts the mail. */
    recipientMasked: text('recipient_masked'),
    /** The provider's id of the accepted message, to look it up in the provider's dashboard. */
    providerMessageId: text('provider_message_id'),
    /**
     * Why the latest attempt failed, as a code: `provider:<provider error name>`, `timeout`, or the
     * error names and Postgres code. Never a message: messages quote addresses and parameters.
     */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mail_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.sentAt} is null and ${t.failedAt} is null and ${t.droppedAt} is null`),
    // One undelivered mail per kind and recipient: a second click while the first is still queued
    // adds nothing (`enqueueMail` inserts with ON CONFLICT DO NOTHING).
    uniqueIndex('mail_outbox_pending_unique')
      .on(t.kind, t.payload)
      .where(sql`${t.sentAt} is null and ${t.failedAt} is null and ${t.droppedAt} is null`),
  ],
);
