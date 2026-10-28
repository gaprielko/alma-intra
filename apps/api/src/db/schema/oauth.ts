import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * An OAuth client that registered itself (dynamic client registration, D-31): claude.ai, Claude
 * Desktop or Claude Code. `info` is what it registered (names, redirect URIs), without the
 * secret of a confidential client.
 */
export const oauthClients = pgTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  info: jsonb('info').$type<Record<string, unknown>>().notNull(),
  /** Encrypted with DATA_ENCRYPTION_KEY: the SDK compares it as given, so it is kept, not hashed. */
  secretEncrypted: text('secret_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One permission a user gave a client, from the request to its revocation: `pending` while the
 * user decides, `code` once approved (an authorization code waits to be exchanged), `active` with
 * an access and a refresh token, `revoked` at the end. Codes and tokens are kept as SHA-256 hashes.
 */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId),
    userId: uuid('user_id').references(() => users.id),
    status: text('status', { enum: ['pending', 'code', 'active', 'revoked'] }).notNull(),
    /** redirect_uri, state, code_challenge, scopes, resource: what the client asked with. */
    request: jsonb('request')
      .$type<{
        redirectUri: string;
        state?: string | undefined;
        codeChallenge: string;
        scopes: string[];
        resource?: string | undefined;
      }>()
      .notNull(),
    requestExpiresAt: timestamp('request_expires_at', { withTimezone: true }).notNull(),
    codeHash: text('code_hash'),
    codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }),
    accessHash: text('access_hash'),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
    refreshHash: text('refresh_hash'),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oauth_grants_code_unique')
      .on(t.codeHash)
      .where(sql`${t.codeHash} is not null`),
    uniqueIndex('oauth_grants_access_unique')
      .on(t.accessHash)
      .where(sql`${t.accessHash} is not null`),
    uniqueIndex('oauth_grants_refresh_unique')
      .on(t.refreshHash)
      .where(sql`${t.refreshHash} is not null`),
    index('oauth_grants_user_idx').on(t.userId),
  ],
);
