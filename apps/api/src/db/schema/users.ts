import { ROLES } from '@intra/shared/auth';
import { USER_STATUSES } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userStatus = pgEnum('user_status', USER_STATUSES);
export const userRole = pgEnum('user_role', ROLES);

/**
 * Everybody who works in Alma Intra. One role for now: every active user may do everything,
 * managing the other users included. `invited` until the invitation is accepted (a password and
 * the second factor set), `deactivated` when a colleague took the access away; nobody is deleted,
 * the audit trail keeps pointing at them.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stored as typed; unique ignoring case (`users_email_unique`). */
    email: text('email').notNull(),
    /** NULL until an invited user sets a password. */
    passwordHash: text('password_hash'),
    /**
     * The name without titles, as the app shows a colleague (an owner, an author, who changed what).
     * The titles join it only in the user list, the e-mails and the communication: `fullNameOf`.
     */
    name: text('name').notNull(),
    /** „Mgr.“, „Ing.“; NULL without one. */
    titleBefore: text('title_before'),
    /** „PhD.“; NULL without one. */
    titleAfter: text('title_after'),
    phone: text('phone'),
    /** Job title, shown to colleagues and in e-mails to organizations. */
    position: text('position'),
    /** Plain text, appended to the e-mails she sends to organizations. */
    emailSignature: text('email_signature'),
    /** Their private addresses, lower-cased: forwards from these can import (email-import.md). */
    importAddresses: jsonb('import_addresses').$type<string[]>().notNull().default([]),
    status: userStatus('status').notNull().default('invited'),
    /** One role for now (`admin`): everybody may do everything, see `can()`. */
    role: userRole('role').notNull().default('admin'),
    /** Who sent the invitation; NULL for the first user, created from the command line. */
    invitedByUserId: uuid('invited_by_user_id').references((): AnyPgColumn => users.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    /** The first session this user ever started. Set once. */
    firstLoginAt: timestamp('first_login_at', { withTimezone: true }),
    /** The latest session start (a login, an accepted invitation, a password reset). */
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /**
     * The last time every session of the user (or every other one) was ended at once: a password
     * change or reset, a deactivation. A second-step challenge issued before it is dead.
     */
    sessionsRevokedAt: timestamp('sessions_revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    check('users_name_length', sql`char_length(${t.name}) between 1 and 120`),
    check(
      'users_signature_length',
      sql`${t.emailSignature} is null or char_length(${t.emailSignature}) <= 1000`,
    ),
  ],
);

/** „Mgr. Jana Horváthová, PhD.“: a colleague with their titles, for the user list and e-mails. */
export const fullNameOf = (u: {
  titleBefore: AnyPgColumn;
  name: AnyPgColumn;
  titleAfter: AnyPgColumn;
}) =>
  sql<string>`concat_ws(' ', nullif(${u.titleBefore}, ''), ${u.name}) || coalesce(', ' || nullif(${u.titleAfter}, ''), '')`;
