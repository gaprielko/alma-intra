import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/*
 * The second factor: TOTP, mandatory for every user. Everything here is the person's, read at the
 * login before there is a session.
 */

/**
 * One row per user who has, or is setting up, an authenticator. The secrets are encrypted with
 * `DATA_ENCRYPTION_KEY` (`encryptField`, bound to this row), never stored in the clear.
 */
export const userSecondFactors = pgTable('user_second_factors', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  /** The confirmed secret; NULL while the first one is still being set up. */
  secretEncrypted: text('secret_encrypted'),
  /** When the secret in force was confirmed with its first code; NULL = no second factor yet. */
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  /**
   * The 30-second step of the last code accepted. A code of that step or any earlier one is
   * refused, so a code seen over somebody's shoulder cannot be used a second time (RFC 6238 §5.2).
   */
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  /**
   * A secret shown in a QR code and not yet confirmed: a first setup, or a new phone while the
   * old secret still holds. It replaces `secret_encrypted` only when a code of it is typed.
   */
  pendingSecretEncrypted: text('pending_secret_encrypted'),
  pendingSince: timestamp('pending_since', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One-time recovery codes, shown once at the setup. Only an argon2 hash is kept; a code used is
 * stamped, never reused. A new setup replaces the whole set.
 */
export const secondFactorRecoveryCodes = pgTable(
  'second_factor_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('second_factor_recovery_codes_user_idx').on(t.userId)],
);

/**
 * „Zapamätať toto zariadenie“: a browser that passed the second step and may skip it for 30 days.
 * The browser holds a random token in an httpOnly cookie; only its SHA-256 is kept here, so the
 * trust can be taken back — a disabled or reset factor, a changed password, a blocked account.
 */
export const secondFactorTrustedDevices = pgTable(
  'second_factor_trusted_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('second_factor_trusted_devices_user_idx').on(t.userId)],
);
