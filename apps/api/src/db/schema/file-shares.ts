import type { CommentAnchor } from '@intra/shared/schemas';
import { SHARE_MODES } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
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
import { files, fileVersions } from './files.js';
import { users } from './users.js';

export const fileShareMode = pgEnum('file_share_mode', SHARE_MODES);
export const fileDraftState = pgEnum('file_draft_state', [
  'waiting',
  'merged',
  'finished',
  'discarded',
]);
export const fileChangeKind = pgEnum('file_change_kind', ['edited', 'deleted']);
export const fileChangeDecision = pgEnum('file_change_decision', [
  'pending',
  'approved',
  'rejected',
]);

/**
 * A file's one public link (docs/file-sharing.md). The token is looked up by its hash and kept
 * encrypted, so „Kopírovať odkaz“ works later; the password only as a hash. Each change of the
 * password moves `passwordGeneration`, which ends the sessions opened with the old one. Cancelling
 * deletes the row, so a new link is a new address.
 */
export const fileShares = pgTable(
  'file_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenEncrypted: text('token_encrypted').notNull(),
    mode: fileShareMode('mode').notNull().default('read'),
    passwordHash: text('password_hash'),
    passwordGeneration: integer('password_generation').notNull().default(0),
    /** The first moment the link no longer opens. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('file_shares_file_unique').on(t.fileId),
    uniqueIndex('file_shares_token_unique').on(t.tokenHash),
    check(
      'file_shares_password_required',
      sql`${t.mode} = 'read' or ${t.passwordHash} is not null`,
    ),
  ],
);

/**
 * Somebody who typed a name on a link. Recognized later by a cookie of this browser on this link,
 * of which only the hash is kept; no fingerprinting. Stays when the link is cancelled: the drafts
 * and comments still name them.
 */
export const fileShareVisitors = pgTable(
  'file_share_visitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    shareId: uuid('share_id').references(() => fileShares.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    deviceTokenHash: text('device_token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('file_share_visitors_device_unique').on(t.deviceTokenHash)],
);

/**
 * What an outsider sent: changes against a version and comments, never a file. It becomes a version
 * only through a colleague. `sessionId` ties together what one visit saved, as its comments belong
 * to all its drafts. `authorNames` as typed: a merged draft has several.
 */
export const fileDrafts = pgTable(
  'file_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    baseVersionId: uuid('base_version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'cascade' }),
    visitorId: uuid('visitor_id').references(() => fileShareVisitors.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id'),
    authorNames: text('author_names').array().notNull(),
    state: fileDraftState('state').notNull().default('waiting'),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => fileDrafts.id, {
      onDelete: 'set null',
    }),
    versionId: uuid('version_id').references(() => fileVersions.id, { onDelete: 'set null' }),
    /** Whoever merged it; a draft from the public page has none. */
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('file_drafts_file_idx').on(t.fileId, t.createdAt),
    index('file_drafts_session_idx').on(t.sessionId),
  ],
);

/**
 * One change of a fragment. `oldHtml` is the fragment's source as it was, by which the change finds
 * its place in a newer version; `newHtml` went through the sanitizer and is null for a deleted one.
 */
export const fileDraftChanges = pgTable(
  'file_draft_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => fileDrafts.id, { onDelete: 'cascade' }),
    block: integer('block').notNull(),
    kind: fileChangeKind('kind').notNull(),
    oldHtml: text('old_html').notNull(),
    newHtml: text('new_html'),
    authorName: text('author_name').notNull(),
    decision: fileChangeDecision('decision').notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('file_draft_changes_draft_idx').on(t.draftId)],
);

/**
 * A comment or, with `parentId`, a reply. A comment needs no version to stay: `versionId` is where
 * it was written, and on newer versions it is found again by its anchor. Either a visitor's or a
 * colleague's; `authorName` holds the name at that moment.
 */
export const fileComments = pgTable(
  'file_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => fileComments.id, {
      onDelete: 'cascade',
    }),
    anchor: jsonb('anchor').$type<CommentAnchor | null>(),
    body: text('body').notNull(),
    visitorId: uuid('visitor_id').references(() => fileShareVisitors.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id),
    sessionId: uuid('session_id'),
    authorName: text('author_name').notNull(),
    agreedAt: timestamp('agreed_at', { withTimezone: true }),
    agreedByUserId: uuid('agreed_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('file_comments_file_idx').on(t.fileId, t.createdAt),
    index('file_comments_parent_idx').on(t.parentId),
  ],
);

/** A comment belongs to every draft of its visit, and a merged draft holds those of its sources. */
export const fileDraftComments = pgTable(
  'file_draft_comments',
  {
    draftId: uuid('draft_id')
      .notNull()
      .references(() => fileDrafts.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => fileComments.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.commentId] })],
);
