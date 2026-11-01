import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './customers.js';
import { users } from './users.js';

/**
 * A folder of the Files module. Two kinds of root: „Firemné dokumenty“ (installed by a migration,
 * no customer, a name) and one per customer (the customer's id, no name: it shows the customer's
 * name). Every other folder has a parent and a name; one inside a customer's tree carries that
 * customer's id too, so the tree is one indexed lookup. A folder is deleted only when empty, so it
 * has no trash.
 */
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    name: text('name'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('folders_parent_idx').on(t.parentId),
    index('folders_organization_idx').on(t.organizationId),
    // One root per customer, and one company root.
    uniqueIndex('folders_organization_root_unique')
      .on(t.organizationId)
      .where(sql`${t.parentId} is null`),
    uniqueIndex('folders_company_root_unique')
      .on(sql`(${t.parentId} is null)`)
      .where(sql`${t.parentId} is null and ${t.organizationId} is null`),
    // A name once per parent.
    uniqueIndex('folders_name_unique')
      .on(t.parentId, sql`lower(${t.name})`)
      .where(sql`${t.parentId} is not null`),
    check(
      'folders_named',
      sql`(${t.parentId} is null and ${t.organizationId} is not null and ${t.name} is null) or ${t.name} is not null`,
    ),
  ],
);

/**
 * What made a version: a person in the web, Claude, a generated document, an inbound mail, or a
 * draft from a public link that a colleague approved.
 */
export const fileVersionSource = pgEnum('file_version_source', [
  'web',
  'mcp',
  'generated',
  'inbound',
  'share',
]);
/** `pending` between the signed upload and its confirmation; `uploaded` once the object was checked. */
export const fileVersionStatus = pgEnum('file_version_status', ['pending', 'uploaded']);

/**
 * A file: a name in one folder, and its versions. `currentVersionId` is the version a download,
 * a preview and the list show; `null` only until the first upload is confirmed, and such a file is
 * shown nowhere. Deleting moves it to „Kôš“ (`deletedAt`); it is purged after `TRASH_DAYS`.
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => folders.id),
    name: text('name').notNull(),
    description: text('description'),
    currentVersionId: uuid('current_version_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  },
  (t) => [
    index('files_folder_idx').on(t.folderId),
    index('files_deleted_idx')
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    check('files_name_length', sql`char_length(${t.name}) between 1 and 200`),
  ],
);

/**
 * One upload of a file's content. Never changed once uploaded: a sent e-mail or an activity points
 * at the version it used. The type and size are what the bucket reported, not what a browser
 * declared. `number` is given on confirmation (v1, v2, …).
 */
export const fileVersions = pgTable(
  'file_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    number: integer('number'),
    status: fileVersionStatus('status').notNull().default('pending'),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    note: text('note'),
    /**
     * The document's date: from the end of the uploaded name (`… 2026-10-28.pdf`), given by Claude,
     * or the day of the upload. Searched by range; the current version's dates the file.
     */
    documentDate: date('document_date', { mode: 'string' }),
    /** The number of the older version this one brought back („Obnoviť“). */
    restoredFrom: integer('restored_from'),
    createdVia: fileVersionSource('created_via').notNull().default('web'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    /** The name(s) typed on a public link, on a `share` version. Self-declared: never a colleague's. */
    externalAuthor: text('external_author'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('file_versions_file_idx').on(t.fileId),
    index('file_versions_document_date_idx').on(t.documentDate),
    uniqueIndex('file_versions_number_unique').on(t.fileId, t.number),
    uniqueIndex('file_versions_key_unique').on(t.storageKey),
  ],
);
