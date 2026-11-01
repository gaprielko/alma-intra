import {
  ACTIVITY_TYPE_DOCUMENT_CHANGE_ID,
  FILE_TYPES,
  fileExtension,
  SHARE_LIMITS,
  type CommentAnchor,
  type ShareMode,
} from '@intra/shared/schemas';
import argon2 from 'argon2';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { decryptField, encryptField, type FieldLocation } from '../crypto/field-encryption.js';
import type { Db, Tx } from '../db/db.module.js';
import {
  fileComments,
  fileDraftChanges,
  fileDraftComments,
  fileDrafts,
  fileShares,
  fileShareVisitors,
  files,
  fileVersions,
  folders,
  leadActivities,
} from '../db/schema/index.js';
import { FileError, folderPath, liveFile } from '../files/files.service.js';
import { notify } from '../notifications/notifications.service.js';
import type { Storage } from '../storage/storage.js';
import {
  documentStyles,
  fragmentForEditor,
  parseFragments,
  sanitizeFragment,
} from './share-html.js';
import {
  clearDeviceCookie,
  frameToken,
  hashToken,
  newToken,
  readDeviceCookie,
  readShareSession,
  setDeviceCookie,
  setShareSession,
  type ShareSession,
} from './share-tokens.js';

/** A refusal the page words for itself (`sk.sharing.errors`). */
export class ShareError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'LOCKED'
      | 'WRONG_PASSWORD'
      | 'NAME_REQUIRED'
      | 'NOT_ALLOWED'
      | 'PASSWORD_REQUIRED'
      | 'NOT_HTML'
      | 'NOT_EDITABLE'
      | 'TOO_LARGE'
      | 'NOT_YOURS'
      | 'NOT_WAITING'
      | 'NOT_READY',
  ) {
    super(code);
  }
}

const tokenField = (shareId: string): FieldLocation => ({
  table: 'file_shares',
  column: 'token_encrypted',
  rowId: shareId,
});

/** The first moment the link no longer opens: the morning after its last day in Bratislava. */
function expiryOf(day: string | null | undefined) {
  if (!day) return null;
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  // Midnight there is 22:00 or 23:00 UTC of the day before; the later one never ends a day early.
  next.setUTCHours(-1);
  return next;
}

const dayOf = (expiresAt: Date | null) =>
  expiresAt
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(
        new Date(expiresAt.getTime() - 1),
      )
    : null;

// ---------------------------------------------------------------------------------------------
// The link, for a colleague

/** A file's link for the dialog; the password itself cannot be shown. */
export async function shareOf(db: Db, env: Env, fileId: string) {
  await liveFile(db, fileId);
  const [share] = await db.select().from(fileShares).where(eq(fileShares.fileId, fileId));
  if (!share) return null;
  return {
    id: share.id,
    url: `${env.WEB_URL}/zdielanie#${decryptField(share.tokenEncrypted, env.DATA_ENCRYPTION_KEY, tokenField(share.id))}`,
    mode: share.mode,
    hasPassword: share.passwordHash !== null,
    expiresOn: dayOf(share.expiresAt),
  };
}

/**
 * Creates or changes a file's link. A new password, or none where there was one, ends the sessions
 * opened with the old one. `null` removes it, nothing keeps it.
 */
export async function saveShare(
  db: Db,
  env: Env,
  userId: string,
  input: {
    fileId: string;
    mode: ShareMode;
    password?: string | null | undefined;
    expiresOn?: string | null | undefined;
  },
) {
  const newHash =
    typeof input.password === 'string' ? await argon2.hash(input.password) : undefined;
  return db.transaction(async (tx) => {
    const file = await liveFile(tx, input.fileId, true);
    if (input.mode !== 'read' && fileExtension(file.name) !== 'html') {
      throw new ShareError('NOT_HTML');
    }
    const [existing] = await tx
      .select()
      .from(fileShares)
      .where(eq(fileShares.fileId, input.fileId));
    const passwordHash =
      newHash ?? (input.password === null ? null : (existing?.passwordHash ?? null));
    if (input.mode !== 'read' && passwordHash === null) throw new ShareError('PASSWORD_REQUIRED');
    const passwordChanged = existing !== undefined && passwordHash !== existing.passwordHash;
    const expiresAt =
      input.expiresOn === undefined ? (existing?.expiresAt ?? null) : expiryOf(input.expiresOn);
    if (existing) {
      await tx
        .update(fileShares)
        .set({
          mode: input.mode,
          passwordHash,
          passwordGeneration: existing.passwordGeneration + (passwordChanged ? 1 : 0),
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(fileShares.id, existing.id));
      return { id: existing.id, passwordChanged, hasPassword: passwordHash !== null, expiresAt };
    }
    const token = newToken();
    const [created] = await tx
      .insert(fileShares)
      .values({
        fileId: input.fileId,
        tokenHash: hashToken(token),
        tokenEncrypted: '',
        mode: input.mode,
        passwordHash,
        expiresAt,
        createdByUserId: userId,
      })
      .returning({ id: fileShares.id });
    await tx
      .update(fileShares)
      .set({
        tokenEncrypted: encryptField(token, env.DATA_ENCRYPTION_KEY, tokenField(created!.id)),
      })
      .where(eq(fileShares.id, created!.id));
    return {
      id: created!.id,
      passwordChanged: false,
      hasPassword: passwordHash !== null,
      expiresAt,
    };
  });
}

/** „Zrušiť zdieľanie“: the address is gone for good; drafts and comments stay in Intra. */
export async function cancelShare(db: Db, fileId: string) {
  const [gone] = await db
    .delete(fileShares)
    .where(eq(fileShares.fileId, fileId))
    .returning({ id: fileShares.id });
  if (!gone) throw new ShareError('NOT_FOUND');
  return gone;
}

// ---------------------------------------------------------------------------------------------
// The public page

export interface LiveShare {
  share: typeof fileShares.$inferSelect;
  file: { id: string; name: string; folderId: string; currentVersionId: string };
}

/**
 * The link of a token, or NOT_FOUND: a wrong token, an expired link, and a file in the trash or of
 * a deleted customer all look the same.
 */
export async function liveShare(db: Db, token: string): Promise<LiveShare> {
  const [row] = await db
    .select({ share: fileShares, file: files })
    .from(fileShares)
    .innerJoin(files, eq(files.id, fileShares.fileId))
    .where(eq(fileShares.tokenHash, hashToken(token)));
  if (
    !row ||
    row.file.deletedAt ||
    !row.file.currentVersionId ||
    (row.share.expiresAt && row.share.expiresAt.getTime() <= Date.now())
  ) {
    throw new ShareError('NOT_FOUND');
  }
  try {
    await folderPath(db, row.file.folderId);
  } catch (error) {
    if (error instanceof FileError) throw new ShareError('NOT_FOUND');
    throw error;
  }
  return {
    share: row.share,
    file: {
      id: row.file.id,
      name: row.file.name,
      folderId: row.file.folderId,
      currentVersionId: row.file.currentVersionId,
    },
  };
}

const asksName = (mode: ShareMode) => mode !== 'read';

/** A session still good for this link as it is now: its password, and a visitor where one is needed. */
function validSession(req: Request, env: Env, live: LiveShare): ShareSession | null {
  const session = readShareSession(req, env, live.share.id);
  if (!session || session.generation !== live.share.passwordGeneration) return null;
  if (asksName(live.share.mode) && !session.visitorId) return null;
  return session;
}

async function recognized(db: Db, req: Request, fileId: string) {
  const token = readDeviceCookie(req, fileId);
  if (!token) return null;
  const [visitor] = await db
    .select()
    .from(fileShareVisitors)
    .where(
      and(
        eq(fileShareVisitors.deviceTokenHash, hashToken(token)),
        eq(fileShareVisitors.fileId, fileId),
      ),
    );
  return visitor ?? null;
}

/** What the access screen asks for. Nothing of the file: not even its name. */
export async function accessInfo(db: Db, env: Env, req: Request, token: string) {
  const live = await liveShare(db, token);
  const visitor = await recognized(db, req, live.file.id);
  const needsPassword = live.share.passwordHash !== null;
  const needsName = asksName(live.share.mode);
  const open = validSession(req, env, live) !== null || (!needsPassword && !needsName);
  return {
    open,
    needsPassword,
    needsName: needsName && !visitor,
    returningName: needsName ? (visitor?.name ?? null) : null,
  };
}

/** Checks what the access screen sent and starts the session; a new visitor gets their cookie. */
export async function unlock(
  db: Db,
  env: Env,
  req: Request,
  res: Response,
  live: LiveShare,
  input: { name?: string | undefined; password?: string | undefined },
) {
  const { share, file } = live;
  if (share.passwordHash !== null) {
    const ok = await argon2.verify(share.passwordHash, input.password ?? '').catch(() => false);
    if (!ok) throw new ShareError('WRONG_PASSWORD');
  }
  let visitorId: string | null = null;
  if (asksName(share.mode)) {
    const known = await recognized(db, req, file.id);
    if (known) {
      visitorId = known.id;
      await db
        .update(fileShareVisitors)
        .set({ lastSeenAt: new Date(), shareId: share.id })
        .where(eq(fileShareVisitors.id, known.id));
      setDeviceCookie(res, file.id, readDeviceCookie(req, file.id)!);
    } else {
      if (!input.name) throw new ShareError('NAME_REQUIRED');
      const device = newToken();
      const [created] = await db
        .insert(fileShareVisitors)
        .values({
          fileId: file.id,
          shareId: share.id,
          name: input.name,
          deviceTokenHash: hashToken(device),
        })
        .returning({ id: fileShareVisitors.id });
      visitorId = created!.id;
      setDeviceCookie(res, file.id, device);
    }
  }
  setShareSession(res, env, {
    shareId: share.id,
    sessionId: crypto.randomUUID(),
    visitorId,
    generation: share.passwordGeneration,
  });
}

/** „Nie som …“: this browser forgets the visitor. */
export async function forgetVisitor(db: Db, res: Response, token: string) {
  const live = await liveShare(db, token);
  clearDeviceCookie(res, live.file.id);
}

export interface OpenedShare extends LiveShare {
  session: ShareSession | null;
  visitorName: string | null;
}

/** Every call of an open page: the link as it is now, and the visitor. Mode comes from here alone. */
export async function openedShare(
  db: Db,
  env: Env,
  req: Request,
  token: string,
  needed: ShareMode = 'read',
): Promise<OpenedShare> {
  const live = await liveShare(db, token);
  const session = validSession(req, env, live);
  if (!session && (live.share.passwordHash !== null || asksName(live.share.mode))) {
    throw new ShareError('LOCKED');
  }
  const rank: Record<ShareMode, number> = { read: 0, comment: 1, edit: 2 };
  if (rank[live.share.mode] < rank[needed]) throw new ShareError('NOT_ALLOWED');
  let visitorName: string | null = null;
  if (session?.visitorId) {
    const [visitor] = await db
      .select({ name: fileShareVisitors.name })
      .from(fileShareVisitors)
      .where(eq(fileShareVisitors.id, session.visitorId));
    if (!visitor) throw new ShareError('LOCKED');
    visitorName = visitor.name;
  }
  return { ...live, session, visitorName };
}

async function currentVersion(db: Db, opened: LiveShare) {
  const [version] = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.id, opened.file.currentVersionId));
  if (!version) throw new ShareError('NOT_FOUND');
  return version;
}

/** The file as the open page shows it. An HTML file comes through its frame, never as bytes. */
export async function openFile(db: Db, env: Env, opened: OpenedShare) {
  const version = await currentVersion(db, opened);
  const html = fileExtension(opened.file.name) === 'html';
  return {
    name: opened.file.name,
    size: version.size,
    versionId: version.id,
    mode: opened.share.mode,
    visitorName: opened.visitorName,
    visitorId: opened.session?.visitorId ?? null,
    canEdit: opened.share.mode === 'edit' && version.size <= SHARE_LIMITS.editableBytes,
    frame: html
      ? `/share-frame/${frameToken(env, { kind: 'version', id: version.id, mode: opened.share.mode })}`
      : null,
  };
}

/** A signed GET of the current version: shown only when a PDF or a photo, otherwise saved. */
export async function fileUrl(db: Db, storage: Storage | null, opened: LiveShare, inline: boolean) {
  if (!storage) throw new ShareError('NOT_FOUND');
  const version = await currentVersion(db, opened);
  const ext = fileExtension(opened.file.name);
  const signed = await storage.createDownloadUrl(version.storageKey, {
    fileName: opened.file.name,
    contentType: version.mime,
    // Only a PDF or a photo is ever shown from the bucket, an SVG or HTML never.
    inline: inline && ext !== null && FILE_TYPES[ext].preview,
  });
  return { url: signed.url };
}

async function versionSource(db: Db, storage: Storage, versionId: string, fileId: string) {
  const [version] = await db
    .select()
    .from(fileVersions)
    .where(
      and(
        eq(fileVersions.id, versionId),
        eq(fileVersions.fileId, fileId),
        eq(fileVersions.status, 'uploaded'),
      ),
    );
  if (!version) throw new ShareError('NOT_FOUND');
  const bytes = await storage.read(version.storageKey);
  return new TextDecoder().decode(bytes);
}

/** One fragment for the editor, from the server's source and never from what the frame says. */
export async function fragmentFor(
  db: Db,
  storage: Storage | null,
  opened: OpenedShare,
  block: number,
) {
  if (!storage) throw new ShareError('NOT_FOUND');
  const source = await versionSource(db, storage, opened.file.currentVersionId, opened.file.id);
  const fragment = fragmentForEditor(source, block);
  if (!fragment) throw new ShareError('NOT_EDITABLE');
  return { ...fragment, styles: documentStyles(source) };
}

// ---------------------------------------------------------------------------------------------
// Drafts and comments from the public page

/** The draft and its activity, in one go: the bell tells whoever made the link. */
async function createDraft(
  tx: Tx,
  opened: OpenedShare,
  session: ShareSession,
  baseVersionId: string,
) {
  const name = opened.visitorName!;
  const [draft] = await tx
    .insert(fileDrafts)
    .values({
      fileId: opened.file.id,
      baseVersionId,
      visitorId: session.visitorId,
      sessionId: session.sessionId,
      authorNames: [name],
    })
    .returning({ id: fileDrafts.id });
  const [folder] = await tx
    .select({ organizationId: folders.organizationId })
    .from(folders)
    .where(eq(folders.id, opened.file.folderId));
  const [activity] = await tx
    .insert(leadActivities)
    .values({
      typeId: ACTIVITY_TYPE_DOCUMENT_CHANGE_ID,
      source: 'share',
      fileDraftId: draft!.id,
      organizationId: folder?.organizationId ?? null,
    })
    .returning({ id: leadActivities.id });
  await notify(tx, {
    userId: opened.share.createdByUserId,
    kind: 'interest',
    refId: activity!.id,
    customerId: folder?.organizationId ?? null,
    subject: opened.file.name,
  });
  return draft!.id;
}

const utf8Length = (text: string) => Buffer.byteLength(text, 'utf8');

/**
 * „Uložiť a poslať na schválenie“: never a version. The server reads each changed fragment itself and
 * lets only what the sanitizer keeps through. A visit's comments-only draft takes the changes; any
 * other save is a draft of its own holding all of what this visit did so far.
 */
export async function saveDraft(
  db: Db,
  storage: Storage | null,
  opened: OpenedShare,
  input: {
    baseVersionId: string;
    ops: { block: number; kind: 'edit' | 'delete'; html?: string | undefined }[];
  },
) {
  const session = opened.session!;
  if (!storage) throw new ShareError('NOT_FOUND');
  const source = await versionSource(db, storage, input.baseVersionId, opened.file.id);
  if (utf8Length(source) > SHARE_LIMITS.editableBytes) throw new ShareError('TOO_LARGE');
  const fragments = parseFragments(source);
  type Change = {
    fragment: (typeof fragments)[number];
    kind: 'edited' | 'deleted';
    oldHtml: string;
    newHtml: string | null;
  };
  const changes = input.ops.flatMap((op): Change[] => {
    const fragment = fragments[op.block];
    if (!fragment) throw new ShareError('NOT_EDITABLE');
    const oldHtml = source.slice(fragment.start, fragment.end);
    if (op.kind === 'delete') {
      return [{ fragment, kind: 'deleted', oldHtml, newHtml: null }];
    }
    if (!fragment.editable || op.html === undefined) throw new ShareError('NOT_EDITABLE');
    const newHtml = sanitizeFragment(op.html, oldHtml);
    return newHtml === oldHtml ? [] : [{ fragment, kind: 'edited', oldHtml, newHtml }];
  });
  // A change inside a fragment deleted as a whole has no meaning of its own.
  const outermost = changes.filter(
    (change) =>
      !changes.some(
        (other) =>
          other !== change &&
          other.fragment.start <= change.fragment.start &&
          other.fragment.end >= change.fragment.end,
      ),
  );
  if (outermost.length === 0) throw new ShareError('NOT_EDITABLE');
  const total = outermost.reduce(
    (sum, c) => sum + utf8Length(c.oldHtml) + utf8Length(c.newHtml ?? ''),
    0,
  );
  if (total > SHARE_LIMITS.draftBytes) throw new ShareError('TOO_LARGE');
  return db.transaction(async (tx) => {
    const [empty] = await tx
      .select({ id: fileDrafts.id })
      .from(fileDrafts)
      .where(
        and(
          eq(fileDrafts.fileId, opened.file.id),
          eq(fileDrafts.sessionId, session.sessionId),
          eq(fileDrafts.state, 'waiting'),
          sql`not exists (select 1 from file_draft_changes c where c.draft_id = ${fileDrafts.id})`,
        ),
      );
    const draftId = empty?.id ?? (await createDraft(tx, opened, session, input.baseVersionId));
    if (empty) {
      await tx
        .update(fileDrafts)
        .set({ baseVersionId: input.baseVersionId })
        .where(eq(fileDrafts.id, empty.id));
    }
    await tx.insert(fileDraftChanges).values(
      outermost.map((change) => ({
        draftId,
        block: change.fragment.block,
        kind: change.kind,
        oldHtml: change.oldHtml,
        newHtml: change.newHtml,
        authorName: opened.visitorName!,
      })),
    );
    const own = await tx
      .select({ id: fileComments.id })
      .from(fileComments)
      .where(
        and(
          eq(fileComments.fileId, opened.file.id),
          eq(fileComments.sessionId, session.sessionId),
          isNull(fileComments.parentId),
          isNull(fileComments.deletedAt),
        ),
      );
    if (own.length > 0) {
      await tx
        .insert(fileDraftComments)
        .values(own.map((c) => ({ draftId, commentId: c.id })))
        .onConflictDoNothing();
    }
    return { draftId, changes: outermost.length, comments: own.length };
  });
}

/**
 * The open comments of a file for the public page, with their replies. `own`: this visitor may still
 * change it, which ends when a colleague agrees to it.
 */
export async function publicComments(db: Db, opened: OpenedShare) {
  const rows = await db
    .select()
    .from(fileComments)
    .where(and(eq(fileComments.fileId, opened.file.id), isNull(fileComments.deletedAt)))
    .orderBy(asc(fileComments.createdAt));
  const visitorId = opened.session?.visitorId ?? null;
  const open = rows.filter((row) => row.parentId === null && row.agreedAt === null);
  return open.map((row) => ({
    id: row.id,
    anchor: row.anchor,
    body: row.body,
    authorName: row.authorName,
    createdAt: row.createdAt,
    own: visitorId !== null && row.visitorId === visitorId,
    sameVersion: row.versionId === opened.file.currentVersionId,
    replies: rows
      .filter((reply) => reply.parentId === row.id)
      .map((reply) => ({
        id: reply.id,
        body: reply.body,
        authorName: reply.authorName,
        colleague: reply.userId !== null,
        createdAt: reply.createdAt,
        own: visitorId !== null && reply.visitorId === visitorId,
      })),
  }));
}

/**
 * Saved at once, visible at once. The first comment of a visit that has no waiting draft makes one:
 * it is what shows in „Koncepty“ and in Aktivity; a reply stays with its comment.
 */
export async function addComment(
  db: Db,
  opened: OpenedShare,
  input: {
    body: string;
    anchor?: CommentAnchor | null | undefined;
    parentId?: string | null | undefined;
  },
) {
  const session = opened.session!;
  return db.transaction(async (tx) => {
    if (input.parentId) {
      const [parent] = await tx
        .select({ id: fileComments.id, parentId: fileComments.parentId })
        .from(fileComments)
        .where(
          and(
            eq(fileComments.id, input.parentId),
            eq(fileComments.fileId, opened.file.id),
            isNull(fileComments.deletedAt),
          ),
        );
      if (!parent || parent.parentId) throw new ShareError('NOT_FOUND');
    }
    const [comment] = await tx
      .insert(fileComments)
      .values({
        fileId: opened.file.id,
        versionId: opened.file.currentVersionId,
        parentId: input.parentId ?? null,
        anchor: input.parentId ? null : (input.anchor ?? null),
        body: input.body,
        visitorId: session.visitorId,
        sessionId: session.sessionId,
        authorName: opened.visitorName!,
      })
      .returning({ id: fileComments.id });
    if (input.parentId) return { id: comment!.id, reply: true };
    const waiting = await tx
      .select({ id: fileDrafts.id })
      .from(fileDrafts)
      .where(
        and(
          eq(fileDrafts.fileId, opened.file.id),
          eq(fileDrafts.sessionId, session.sessionId),
          eq(fileDrafts.state, 'waiting'),
        ),
      );
    const drafts = waiting.map((d) => d.id);
    if (drafts.length === 0) {
      drafts.push(await createDraft(tx, opened, session, opened.file.currentVersionId));
    }
    await tx
      .insert(fileDraftComments)
      .values(drafts.map((draftId) => ({ draftId, commentId: comment!.id })));
    return { id: comment!.id, reply: false };
  });
}

/** A visitor's own comment, while no colleague has agreed to it. */
async function ownComment(tx: Tx, opened: OpenedShare, id: string) {
  const [comment] = await tx
    .select()
    .from(fileComments)
    .where(
      and(
        eq(fileComments.id, id),
        eq(fileComments.fileId, opened.file.id),
        isNull(fileComments.deletedAt),
      ),
    )
    .for('update');
  if (!comment) throw new ShareError('NOT_FOUND');
  // The visitor comes from the signed cookie, never from the input.
  if (!opened.session?.visitorId || comment.visitorId !== opened.session.visitorId) {
    throw new ShareError('NOT_YOURS');
  }
  if (comment.agreedAt) throw new ShareError('NOT_YOURS');
  return comment;
}

export async function editComment(db: Db, opened: OpenedShare, id: string, body: string) {
  return db.transaction(async (tx) => {
    await ownComment(tx, opened, id);
    await tx
      .update(fileComments)
      .set({ body, updatedAt: new Date() })
      .where(eq(fileComments.id, id));
  });
}

/** Deleting the last comment of a draft holding nothing else discards the draft as well. */
export async function deleteComment(db: Db, opened: OpenedShare, id: string) {
  return db.transaction(async (tx) => {
    const comment = await ownComment(tx, opened, id);
    await tx
      .update(fileComments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(or(eq(fileComments.id, id), eq(fileComments.parentId, id)));
    if (comment.parentId) return;
    const holding = await tx
      .select({ draftId: fileDraftComments.draftId })
      .from(fileDraftComments)
      .where(eq(fileDraftComments.commentId, id));
    if (holding.length === 0) return;
    await tx.delete(fileDraftComments).where(eq(fileDraftComments.commentId, id));
    await tx
      .update(fileDrafts)
      .set({ state: 'discarded', finishedAt: new Date() })
      .where(
        and(
          inArray(
            fileDrafts.id,
            holding.map((h) => h.draftId),
          ),
          eq(fileDrafts.state, 'waiting'),
          sql`not exists (select 1 from file_draft_changes c where c.draft_id = ${fileDrafts.id})`,
          sql`not exists (select 1 from file_draft_comments dc where dc.draft_id = ${fileDrafts.id})`,
        ),
      );
  });
}
