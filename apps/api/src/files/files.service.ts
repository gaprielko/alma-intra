import {
  COMPANY_ROOT_FOLDER_ID,
  FILE_TYPES,
  type FileGroup,
  fileExtension,
  type FolderContentsInput,
  TRASH_DAYS,
} from '@intra/shared/schemas';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import type { Db, Tx } from '../db/db.module.js';
import { auditEvents, customers, files, fileVersions, folders, users } from '../db/schema/index.js';
import { type Storage, storageKey } from '../storage/storage.js';

/** A refusal the web words for itself (`sk.files.errors`). */
export class FileError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'STORAGE_NOT_CONFIGURED'
      | 'NAME_TAKEN'
      | 'FOLDER_NOT_EMPTY'
      | 'ROOT_FOLDER'
      | 'MOVE_INTO_ITSELF'
      | 'OTHER_TREE'
      | 'TYPE_MISMATCH'
      | 'UPLOAD_MISSING'
      | 'UPLOAD_MISMATCH',
  ) {
    super(code);
  }
}

/** Object storage is optional in development and tests; checked after the row was found. */
function requireStorage(storage: Storage | null): Storage {
  if (!storage) throw new FileError('STORAGE_NOT_CONFIGURED');
  return storage;
}

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const collated = (column: SQL) => sql`${column} collate "sk-x-icu"`;

/** A file the lists show: not in the trash, with a confirmed version. */
const live = and(isNull(files.deletedAt), isNotNull(files.currentVersionId));

const constraintOf = (error: unknown) =>
  (error as { constraint?: string; cause?: { constraint?: string } } | null)?.constraint ??
  (error as { cause?: { constraint?: string } } | null)?.cause?.constraint;

async function mapUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (constraintOf(error) === 'folders_name_unique') throw new FileError('NAME_TAKEN');
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Folders

export interface FolderStep {
  id: string;
  /** A customer's root shows the customer's name. */
  name: string;
  customerId: string | null;
}

/**
 * The folders from the root down to this one. A folder of a deleted customer is not there
 * (NOT_FOUND), like the customer.
 */
export async function folderPath(db: Db | Tx, folderId: string): Promise<FolderStep[]> {
  const result = await db.execute<{
    id: string;
    name: string | null;
    customer_id: string | null;
    customer_deleted: boolean | null;
  }>(sql`
    with recursive p as (
      select id, parent_id, customer_id, name, 0 as depth from folders where id = ${folderId}
      union all
      select f.id, f.parent_id, f.customer_id, f.name, p.depth + 1
      from folders f join p on f.id = p.parent_id
    )
    select p.id, coalesce(p.name, c.name) as name, p.customer_id,
      (c.deleted_at is not null) as customer_deleted
    from p left join customers c on c.id = p.customer_id and p.parent_id is null
    order by p.depth desc`);
  const rows = result.rows;
  if (rows.length === 0 || rows.some((row) => row.customer_deleted)) {
    throw new FileError('NOT_FOUND');
  }
  return rows.map((row) => ({ id: row.id, name: row.name ?? '', customerId: row.customer_id }));
}

/** The company's folders, flat with their parents, and how many files each holds directly. */
export async function companyTree(db: Db) {
  const rows = await db
    .select({
      id: folders.id,
      parentId: folders.parentId,
      name: folders.name,
      fileCount: sql<number>`(select count(*)::int from files f
        where f.folder_id = "folders"."id" and f.deleted_at is null and f.current_version_id is not null)`,
    })
    .from(folders)
    .where(and(isNull(folders.customerId), isNotNull(folders.parentId)))
    .orderBy(collated(sql`${folders.name}`));
  const [trash] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(files)
    .where(
      and(
        isNotNull(files.deletedAt),
        isNotNull(files.currentVersionId),
        sql`${files.deletedAt} > now() - make_interval(days => ${TRASH_DAYS})`,
      ),
    );
  return {
    rootId: COMPANY_ROOT_FOLDER_ID,
    folders: rows.map((row) => ({ ...row, name: row.name ?? '' })),
    trashCount: trash?.count ?? 0,
  };
}

/**
 * The customers' folders for the tree: with a search the customers whose name matches, otherwise
 * the ones with the most files. `total`: every customer, for „Všetci zákazníci“.
 */
export async function customerFolders(db: Db, search: string | undefined, limit: number) {
  const fileCount = sql<number>`(select count(*)::int from files f join folders fo on fo.id = f.folder_id
    where fo.customer_id = "customers"."id" and f.deleted_at is null and f.current_version_id is not null)`;
  const where = [isNull(customers.deletedAt)];
  if (search) where.push(sql`${customers.name} ilike ${likePattern(search)}`);
  const rows = await db
    .select({
      folderId: folders.id,
      customerId: customers.id,
      name: customers.name,
      fileCount,
    })
    .from(customers)
    .innerJoin(folders, and(eq(folders.customerId, customers.id), isNull(folders.parentId)))
    .where(and(...where))
    .orderBy(...(search ? [] : [desc(fileCount)]), collated(sql`${customers.name}`))
    .limit(limit);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(isNull(customers.deletedAt));
  return { items: rows, total: total?.count ?? 0 };
}

/** The root of a customer's folder tree, made when the customer is. */
export async function createCustomerFolder(tx: Tx, customerId: string) {
  await tx.insert(folders).values({ customerId }).onConflictDoNothing();
}

export async function customerRootFolderId(db: Db | Tx, customerId: string) {
  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .innerJoin(customers, eq(customers.id, folders.customerId))
    .where(
      and(
        eq(folders.customerId, customerId),
        isNull(folders.parentId),
        isNull(customers.deletedAt),
      ),
    );
  if (!row) throw new FileError('NOT_FOUND');
  return row.id;
}

export async function createFolder(db: Db, userId: string, parentId: string, name: string) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      const path = await folderPath(tx, parentId);
      const [created] = await tx
        .insert(folders)
        .values({ parentId, name, customerId: path[0]!.customerId, createdByUserId: userId })
        .returning({ id: folders.id });
      return { id: created!.id };
    }),
  );
}

async function ownFolder(tx: Tx, id: string) {
  const [folder] = await tx.select().from(folders).where(eq(folders.id, id)).for('update');
  if (!folder) throw new FileError('NOT_FOUND');
  await folderPath(tx, id);
  if (folder.parentId === null) throw new FileError('ROOT_FOLDER');
  return folder;
}

export async function renameFolder(db: Db, id: string, name: string) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      await ownFolder(tx, id);
      await tx.update(folders).set({ name, updatedAt: new Date() }).where(eq(folders.id, id));
    }),
  );
}

/**
 * A folder into another one of the same tree: the company's folders stay the company's, a
 * customer's stay that customer's. Never into itself or below itself.
 */
export async function moveFolder(db: Db, id: string, parentId: string) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      const folder = await ownFolder(tx, id);
      const target = await folderPath(tx, parentId);
      if (target.some((step) => step.id === id)) throw new FileError('MOVE_INTO_ITSELF');
      if (target[0]!.customerId !== folder.customerId) throw new FileError('OTHER_TREE');
      await tx.update(folders).set({ parentId, updatedAt: new Date() }).where(eq(folders.id, id));
    }),
  );
}

/**
 * Only an empty folder is deleted: no folders in it, no files outside the trash. Files of it
 * still in the trash move up to its parent, so they can be restored somewhere.
 */
export async function deleteFolder(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const folder = await ownFolder(tx, id);
    const [content] = await tx
      .select({
        folders: sql<number>`(select count(*)::int from folders c where c.parent_id = ${id})`,
        files: sql<number>`(select count(*)::int from files f
          where f.folder_id = ${id} and f.deleted_at is null and f.current_version_id is not null)`,
      })
      .from(sql`(select 1) as one`);
    if ((content?.folders ?? 0) > 0 || (content?.files ?? 0) > 0) {
      throw new FileError('FOLDER_NOT_EMPTY');
    }
    await tx.update(files).set({ folderId: folder.parentId! }).where(eq(files.folderId, id));
    await tx.delete(folders).where(eq(folders.id, id));
    return { parentId: folder.parentId! };
  });
}

// ---------------------------------------------------------------------------------------------
// Listing

/** The content types of a group of the type filter. */
function mimesOf(group: FileGroup): string[] {
  return [
    ...new Set(
      Object.values(FILE_TYPES)
        .filter((type) => type.group === group)
        .map((type) => type.mime),
    ),
  ];
}

const PERIOD_DAYS = { week: 7, month: 31, year: 366 } as const;
const changer = alias(users, 'changer');
const SEARCH_LIMIT = 100;

/** A row of a file list: the current version's size, number, time and author. */
function fileRows(db: Db, where: SQL[]) {
  return db
    .select({
      id: files.id,
      name: files.name,
      folderId: files.folderId,
      folderName: sql<string>`coalesce(${folders.name}, ${customers.name})`,
      size: fileVersions.size,
      mime: fileVersions.mime,
      // Set on every confirmed version, and only those are current.
      version: sql<number>`${fileVersions.number}`,
      changedAt: fileVersions.createdAt,
      changedVia: fileVersions.createdVia,
      changedBy: changer.name,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .innerJoin(folders, eq(folders.id, files.folderId))
    .leftJoin(customers, eq(customers.id, folders.customerId))
    .leftJoin(changer, eq(changer.id, fileVersions.createdByUserId))
    .where(and(...where));
}

/**
 * A folder's sub-folders and files, or with `search` the matching files of every folder (a deleted
 * customer's excepted). The type, author and period filters narrow the files.
 */
export async function folderContents(db: Db, input: FolderContentsInput) {
  const path = await folderPath(db, input.folderId);
  const where: SQL[] = [isNull(files.deletedAt)];
  if (input.group) where.push(inArray(fileVersions.mime, mimesOf(input.group)));
  if (input.changedBy) where.push(eq(fileVersions.createdByUserId, input.changedBy));
  if (input.period) {
    where.push(
      sql`${fileVersions.createdAt} > now() - make_interval(days => ${PERIOD_DAYS[input.period]})`,
    );
  }

  if (input.search) {
    where.push(
      sql`${files.name} ilike ${likePattern(input.search)}`,
      or(isNull(folders.customerId), isNull(customers.deletedAt))!,
    );
    const rows = await fileRows(db, where)
      .orderBy(desc(fileVersions.createdAt))
      .limit(SEARCH_LIMIT);
    return { path, folders: [], files: rows, searched: true };
  }

  where.push(eq(files.folderId, input.folderId));
  const [sub, rows] = await Promise.all([
    db
      .select({
        id: folders.id,
        name: sql<string>`${folders.name}`,
        updatedAt: folders.updatedAt,
        fileCount: sql<number>`(select count(*)::int from files f
          where f.folder_id = "folders"."id" and f.deleted_at is null and f.current_version_id is not null)`,
      })
      .from(folders)
      .where(eq(folders.parentId, input.folderId))
      .orderBy(collated(sql`${folders.name}`)),
    fileRows(db, where).orderBy(collated(sql`${files.name}`)),
  ]);
  return { path, folders: sub, files: rows, searched: false };
}

/** The colleagues who changed a file, for the author filter. */
export async function fileAuthors(db: Db) {
  return db
    .selectDistinct({ id: users.id, name: users.name })
    .from(fileVersions)
    .innerJoin(users, eq(users.id, fileVersions.createdByUserId))
    .where(eq(fileVersions.status, 'uploaded'))
    .orderBy(asc(users.name));
}

/** The newest files anywhere in a customer's folders, for the customer's detail. */
export async function customerFiles(db: Db, customerId: string) {
  const rootId = await customerRootFolderId(db, customerId);
  const where = [isNull(files.deletedAt), eq(folders.customerId, customerId)];
  const [rows, [count]] = await Promise.all([
    fileRows(db, where).orderBy(desc(fileVersions.createdAt)).limit(5),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(files)
      .innerJoin(folders, eq(folders.id, files.folderId))
      .where(and(live, eq(folders.customerId, customerId))),
  ]);
  return { rootId, files: rows, total: count?.count ?? 0 };
}

// ---------------------------------------------------------------------------------------------
// Uploads

/** A Office document and a ZIP are ZIP archives; the text types must hold no NUL byte. */
const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  pdf: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]),
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  webp: (b) =>
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
    [0x57, 0x45, 0x42, 0x50].every((byte, i) => b[8 + i] === byte),
  docx: isZip,
  xlsx: isZip,
  pptx: isZip,
  odt: isZip,
  zip: isZip,
  txt: isText,
  md: isText,
  csv: isText,
  svg: isText,
};
export const SIGNATURE_LENGTH = 512;

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((byte, i) => bytes[i] === byte);
}
function isZip(bytes: Uint8Array) {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
}
function isText(bytes: Uint8Array) {
  return !bytes.includes(0);
}

/** Whether the first bytes are those of a file with this name's extension. */
export function hasSignature(bytes: Uint8Array, name: string): boolean {
  const ext = fileExtension(name);
  return ext !== null && SIGNATURES[ext]!(bytes);
}

/** The stored and served content type: by the extension, never by what a browser declared. */
function mimeOf(name: string): string {
  const ext = fileExtension(name);
  if (!ext) throw new FileError('TYPE_MISMATCH');
  return FILE_TYPES[ext].mime;
}

async function pendingVersion(
  tx: Tx,
  storage: Storage,
  file: { id: string },
  values: { mime: string; size: number; note?: string | undefined; userId: string },
) {
  const versionId = randomUUID();
  const key = storageKey(file.id, versionId);
  await tx.insert(fileVersions).values({
    id: versionId,
    fileId: file.id,
    storageKey: key,
    mime: values.mime,
    size: values.size,
    note: values.note || null,
    createdByUserId: values.userId,
  });
  const upload = await storage.createUploadUrl(key, {
    contentType: values.mime,
    contentLength: values.size,
  });
  return { versionId, url: upload.url, contentType: values.mime };
}

/**
 * A new file in a folder: a row nobody sees yet, a pending version and a signed PUT bound to the
 * type and the size. The file shows once `confirmUpload` checked what arrived.
 */
export async function requestUpload(
  db: Db,
  storage: Storage | null,
  userId: string,
  input: { folderId: string; name: string; size: number },
) {
  return db.transaction(async (tx) => {
    await folderPath(tx, input.folderId);
    const bucket = requireStorage(storage);
    const [file] = await tx
      .insert(files)
      .values({ folderId: input.folderId, name: input.name, createdByUserId: userId })
      .returning({ id: files.id });
    const upload = await pendingVersion(tx, bucket, file!, {
      mime: mimeOf(input.name),
      size: input.size,
      userId,
    });
    return { fileId: file!.id, ...upload };
  });
}

/** A file outside the trash, or NOT_FOUND. */
async function liveFile(db: Db | Tx, id: string, lock = false) {
  const query = db
    .select()
    .from(files)
    .where(and(eq(files.id, id), live));
  const [file] = await (lock ? query.for('update') : query);
  if (!file) throw new FileError('NOT_FOUND');
  await folderPath(db, file.folderId);
  return file;
}

/** A new version of a file: the same extension, so a DOCX stays a DOCX. */
export async function requestVersion(
  db: Db,
  storage: Storage | null,
  userId: string,
  input: { fileId: string; name: string; size: number; note?: string | undefined },
) {
  return db.transaction(async (tx) => {
    const file = await liveFile(tx, input.fileId);
    const bucket = requireStorage(storage);
    if (fileExtension(file.name) !== fileExtension(input.name)) {
      throw new FileError('TYPE_MISMATCH');
    }
    const upload = await pendingVersion(tx, bucket, file, {
      mime: mimeOf(file.name),
      size: input.size,
      note: input.note,
      userId,
    });
    return { fileId: file.id, ...upload };
  });
}

/**
 * The upload arrived: HEAD is the truth about type and size, and the first bytes must look like
 * the extension says. An object that does not match is deleted and the version stays pending (the
 * purge removes it). A match gets the next number and becomes the file's current version.
 */
export async function confirmUpload(db: Db, storage: Storage | null, versionId: string) {
  const [version] = await db
    .select({
      id: fileVersions.id,
      fileId: fileVersions.fileId,
      status: fileVersions.status,
      storageKey: fileVersions.storageKey,
      mime: fileVersions.mime,
      size: fileVersions.size,
      number: fileVersions.number,
      name: files.name,
    })
    .from(fileVersions)
    .innerJoin(files, eq(files.id, fileVersions.fileId))
    .where(and(eq(fileVersions.id, versionId), isNull(files.deletedAt)));
  if (!version) throw new FileError('NOT_FOUND');
  const bucket = requireStorage(storage);
  if (version.status === 'uploaded') {
    return { fileId: version.fileId, number: version.number!, first: version.number === 1 };
  }

  const object = await bucket.head(version.storageKey);
  if (!object) throw new FileError('UPLOAD_MISSING');
  const matches =
    object.contentType === version.mime &&
    object.contentLength === version.size &&
    hasSignature(await bucket.readPrefix(version.storageKey, SIGNATURE_LENGTH), version.name);
  if (!matches) {
    await bucket.delete(version.storageKey);
    throw new FileError('UPLOAD_MISMATCH');
  }

  return db.transaction(async (tx) => {
    await tx.select({ id: files.id }).from(files).where(eq(files.id, version.fileId)).for('update');
    const [again] = await tx
      .select({ status: fileVersions.status, number: fileVersions.number })
      .from(fileVersions)
      .where(eq(fileVersions.id, versionId));
    if (again?.status === 'uploaded') {
      return { fileId: version.fileId, number: again.number!, first: again.number === 1 };
    }
    const number = await nextNumber(tx, version.fileId);
    await tx
      .update(fileVersions)
      .set({ status: 'uploaded', number })
      .where(eq(fileVersions.id, versionId));
    await tx
      .update(files)
      .set({ currentVersionId: versionId, updatedAt: new Date() })
      .where(eq(files.id, version.fileId));
    return { fileId: version.fileId, number, first: number === 1 };
  });
}

async function nextNumber(tx: Tx, fileId: string) {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${fileVersions.number}), 0)::int` })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId));
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------------------------
// A file

const creator = alias(users, 'creator');

/** The file's sheet: where it is, who made it, its versions newest first. */
export async function fileDetail(db: Db, id: string) {
  const [file] = await db
    .select({
      id: files.id,
      name: files.name,
      description: files.description,
      folderId: files.folderId,
      currentVersionId: files.currentVersionId,
      createdAt: files.createdAt,
      createdBy: creator.name,
      deletedAt: files.deletedAt,
    })
    .from(files)
    .leftJoin(creator, eq(creator.id, files.createdByUserId))
    .where(and(eq(files.id, id), isNotNull(files.currentVersionId)));
  if (!file) throw new FileError('NOT_FOUND');
  const path = await folderPath(db, file.folderId);
  const versions = await db
    .select({
      id: fileVersions.id,
      number: fileVersions.number,
      size: fileVersions.size,
      mime: fileVersions.mime,
      note: fileVersions.note,
      restoredFrom: fileVersions.restoredFrom,
      createdVia: fileVersions.createdVia,
      createdAt: fileVersions.createdAt,
      createdBy: users.name,
    })
    .from(fileVersions)
    .leftJoin(users, eq(users.id, fileVersions.createdByUserId))
    .where(and(eq(fileVersions.fileId, id), eq(fileVersions.status, 'uploaded')))
    .orderBy(desc(fileVersions.number));
  return { ...file, path, versions };
}

/** The file's audit events, newest first. */
export async function fileHistory(db: Db, id: string) {
  const rows = await db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      action: auditEvents.action,
      diff: auditEvents.diff,
      userName: users.name,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.userId))
    .where(
      and(
        eq(auditEvents.entityType, 'file'),
        eq(auditEvents.entityId, id),
        sql`${auditEvents.action} not like '%.failed' and ${auditEvents.action} not like '%.denied'`,
      ),
    )
    .orderBy(desc(auditEvents.at))
    .limit(50);
  return rows as {
    id: string;
    at: Date;
    action: string;
    diff: Record<string, unknown> | null;
    userName: string | null;
  }[];
}

/**
 * A signed GET of a version (the current one by default). Only a PDF or a photo is shown in the
 * browser; everything else, an SVG included, is saved.
 */
export async function downloadUrl(
  db: Db,
  storage: Storage | null,
  input: { id: string; versionId?: string | undefined; inline: boolean },
) {
  const file = await liveFile(db, input.id);
  const [version] = await db
    .select({
      id: fileVersions.id,
      number: fileVersions.number,
      storageKey: fileVersions.storageKey,
      mime: fileVersions.mime,
    })
    .from(fileVersions)
    .where(
      and(
        eq(fileVersions.id, input.versionId ?? file.currentVersionId!),
        eq(fileVersions.fileId, file.id),
        eq(fileVersions.status, 'uploaded'),
      ),
    );
  if (!version) throw new FileError('NOT_FOUND');
  const bucket = requireStorage(storage);
  const ext = fileExtension(file.name);
  const inline = input.inline && ext !== null && FILE_TYPES[ext].preview;
  const signed = await bucket.createDownloadUrl(version.storageKey, {
    fileName: file.name,
    contentType: version.mime,
    inline,
  });
  return { url: signed.url, versionId: version.id, number: version.number!, inline };
}

/** The extension stays: a rename never turns a DOCX into something else. */
export async function renameFile(db: Db, id: string, name: string) {
  return db.transaction(async (tx) => {
    const file = await liveFile(tx, id, true);
    if (fileExtension(file.name) !== fileExtension(name)) throw new FileError('TYPE_MISMATCH');
    await tx.update(files).set({ name, updatedAt: new Date() }).where(eq(files.id, id));
  });
}

export async function describeFile(db: Db, id: string, description: string) {
  return db.transaction(async (tx) => {
    await liveFile(tx, id, true);
    await tx
      .update(files)
      .set({ description: description || null, updatedAt: new Date() })
      .where(eq(files.id, id));
  });
}

/** Into any folder, the company's or a customer's: a file has one place. */
export async function moveFile(db: Db, id: string, folderId: string) {
  return db.transaction(async (tx) => {
    const file = await liveFile(tx, id, true);
    const target = await folderPath(tx, folderId);
    await tx.update(files).set({ folderId, updatedAt: new Date() }).where(eq(files.id, id));
    return { from: file.folderId, customerId: target[0]!.customerId };
  });
}

/**
 * „Obnoviť“: an older version becomes the newest one, as a copy with an object of its own, so the
 * history only ever grows and the older version stays what it was.
 */
export async function restoreVersion(
  db: Db,
  storage: Storage | null,
  userId: string,
  versionId: string,
) {
  const [old] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.id, versionId), eq(fileVersions.status, 'uploaded')));
  if (!old) throw new FileError('NOT_FOUND');
  await liveFile(db, old.fileId);
  const bucket = requireStorage(storage);
  const newId = randomUUID();
  const key = storageKey(old.fileId, newId);
  await bucket.copy(old.storageKey, key);
  return db.transaction(async (tx) => {
    await liveFile(tx, old.fileId, true);
    const number = await nextNumber(tx, old.fileId);
    await tx.insert(fileVersions).values({
      id: newId,
      fileId: old.fileId,
      number,
      status: 'uploaded',
      storageKey: key,
      mime: old.mime,
      size: old.size,
      restoredFrom: old.number,
      createdByUserId: userId,
    });
    await tx
      .update(files)
      .set({ currentVersionId: newId, updatedAt: new Date() })
      .where(eq(files.id, old.fileId));
    return { fileId: old.fileId, number, restoredFrom: old.number! };
  });
}

// ---------------------------------------------------------------------------------------------
// Trash

export async function trashFile(db: Db, userId: string, id: string) {
  return db.transaction(async (tx) => {
    await liveFile(tx, id, true);
    await tx
      .update(files)
      .set({ deletedAt: new Date(), deletedByUserId: userId })
      .where(eq(files.id, id));
  });
}

/** Back where it was; the folder still exists, a deleted folder handed its trash up. */
export async function restoreFile(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const [file] = await tx
      .select()
      .from(files)
      .where(and(eq(files.id, id), isNotNull(files.deletedAt)))
      .for('update');
    if (!file) throw new FileError('NOT_FOUND');
    await folderPath(tx, file.folderId);
    await tx
      .update(files)
      .set({ deletedAt: null, deletedByUserId: null, updatedAt: new Date() })
      .where(eq(files.id, id));
    return { folderId: file.folderId };
  });
}

const remover = alias(users, 'remover');

/** „Kôš“: deleted files, newest first, with the day each is deleted for good. */
export async function trashList(db: Db) {
  return db
    .select({
      id: files.id,
      name: files.name,
      folderId: files.folderId,
      folderName: sql<string>`coalesce(${folders.name}, ${customers.name})`,
      size: fileVersions.size,
      mime: fileVersions.mime,
      deletedAt: sql<Date>`${files.deletedAt}`,
      deletedBy: remover.name,
      purgeAt: sql<Date>`${files.deletedAt} + make_interval(days => ${TRASH_DAYS})`,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .innerJoin(folders, eq(folders.id, files.folderId))
    .leftJoin(customers, eq(customers.id, folders.customerId))
    .leftJoin(remover, eq(remover.id, files.deletedByUserId))
    .where(
      and(
        isNotNull(files.deletedAt),
        // Past its 30 days a file is gone for the user, even when an activity keeps it.
        sql`${files.deletedAt} > now() - make_interval(days => ${TRASH_DAYS})`,
      ),
    )
    .orderBy(desc(files.deletedAt))
    .limit(200);
}

/** Pending uploads older than this never arrived: a signed PUT lives 10 minutes. */
const STALE_PENDING_HOURS = 24;

/**
 * Deletes for good what the trash held longer than `TRASH_DAYS`, and the uploads that never were
 * confirmed: the objects first, then the rows. An object that cannot be deleted keeps its row,
 * and the next run tries again.
 *
 * A file an activity keeps a version of stays (spec 7.2): it leaves the trash's list after
 * `TRASH_DAYS` but is never destroyed. Sent e-mails (E5) will be kept the same way.
 */
export async function purgeFiles(db: Db, storage: Storage) {
  const expired = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        lt(files.deletedAt, sql`now() - make_interval(days => ${TRASH_DAYS})`),
        // A version an activity keeps stays: hidden from the trash, never destroyed.
        sql`not exists (select 1 from file_versions v join activity_attachments aa
          on aa.file_version_id = v.id where v.file_id = ${files.id})`,
        // Nor one a sent e-mail carried (spec 7.2).
        sql`not exists (select 1 from file_versions v join message_attachments ma
          on ma.file_version_id = v.id where v.file_id = ${files.id})`,
      ),
    );
  const stale = await db
    .select({ id: fileVersions.id, key: fileVersions.storageKey, fileId: fileVersions.fileId })
    .from(fileVersions)
    .where(
      and(
        eq(fileVersions.status, 'pending'),
        lt(fileVersions.createdAt, sql`now() - make_interval(hours => ${STALE_PENDING_HOURS})`),
      ),
    );

  let purgedFiles = 0;
  for (const file of expired) {
    const versions = await db
      .select({ key: fileVersions.storageKey })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, file.id));
    try {
      for (const version of versions) await storage.delete(version.key);
    } catch {
      continue;
    }
    await db.delete(files).where(eq(files.id, file.id));
    purgedFiles += 1;
  }

  let purgedUploads = 0;
  for (const version of stale) {
    try {
      await storage.delete(version.key);
    } catch {
      continue;
    }
    await db.delete(fileVersions).where(eq(fileVersions.id, version.id));
    // A new file whose first upload never arrived has nothing left.
    await db
      .delete(files)
      .where(
        and(
          eq(files.id, version.fileId),
          isNull(files.currentVersionId),
          sql`not exists (select 1 from file_versions v where v.file_id = ${version.fileId})`,
        ),
      );
    purgedUploads += 1;
  }
  return { purgedFiles, purgedUploads };
}
