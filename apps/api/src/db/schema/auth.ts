import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Rotating refresh tokens. Only the SHA-256 of a token is stored. All tokens issued from one
 * login share `family_id`; presenting an already rotated token revokes the whole family, except
 * within the short grace window after the rotation.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Set together with `revoked_at` when the token was exchanged for its successor, as opposed to
     * revoked by logout, reuse or a colleague. Starts the grace window for a parallel refresh.
     */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    /** The browser that started the session, cut to 200 characters; shown on „Môj účet“. */
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
    // "Is this session alive?" runs on every authenticated request: only the few tokens that are
    // not revoked are in here, however long the history of a family is.
    index('refresh_tokens_live_family_idx')
      .on(t.familyId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

export const authTokenType = pgEnum('auth_token_type', ['invitation', 'password_reset']);

/** One-time tokens sent by e-mail. Only the SHA-256 of a token is stored. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: authTokenType('type').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_tokens_user_idx').on(t.userId)],
);

/**
 * Fixed-window counters for the auth procedures. In Postgres rather than in memory so the limit
 * holds across API instances and restarts. `key` is a SHA-256 of scope + subject: pseudonymised,
 * not anonymous (an IPv4 address can be brute-forced from it), so rows are short-lived.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index('rate_limits_window_start_idx').on(t.windowStart),
  ],
);
