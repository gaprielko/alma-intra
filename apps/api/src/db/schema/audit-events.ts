import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Append-only audit trail. Rows are written by the audit interceptor only. The runtime role may
 * INSERT and SELECT; UPDATE, DELETE and TRUNCATE are revoked (migration `0001_audit_append_only`).
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').references(() => users.id),
    /** tRPC procedure path, e.g. `user.invite`. */
    action: text('action').notNull(),
    kind: text('kind', { enum: ['mutation', 'read'] }).notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    /** Field names, or allow-listed values / before-after pairs; never secrets or personal data. */
    diff: jsonb('diff'),
    requestId: text('request_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('audit_events_at_idx').on(t.at),
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    index('audit_events_user_at_idx').on(t.userId, t.at),
  ],
);
