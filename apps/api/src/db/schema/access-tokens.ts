import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * A personal access token for Claude Code (D-31): made under „Môj účet“, shown once, kept as a
 * SHA-256 hash; it expires, can be revoked, and remembers when it was last used. Claude acts with
 * it as the user, never more.
 */
export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('personal_access_tokens_hash_unique').on(t.tokenHash),
    index('personal_access_tokens_user_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);
