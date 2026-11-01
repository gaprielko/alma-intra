import { fileExtension, SHARE_LIMITS, type CommentAnchor } from '@intra/shared/schemas';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Db, Tx } from '../db/db.module.js';
import {
  fileComments,
  fileDraftChanges,
  fileDraftComments,
  fileDrafts,
  fileShares,
  files,
  fileVersions,
  fullNameOf,
  users,
} from '../db/schema/index.js';
import { addVersionFromBytes, FileError, folderPath, liveFile } from '../files/files.service.js';
import type { Storage } from '../storage/storage.js';
import { applyChanges, documentStyles, fragmentForEditor, resolveChanges } from './share-html.js';
import { frameToken, hashToken } from './share-tokens.js';
import {
  type ChangeOp,
  dropComment,
  preparedChanges,
  ShareError,
  versionSource,
} from './shares.service.js';

/**
 * Which file a link is about, for a colleague, who has access to every file anyway: the link's
 * expiry, password and mode are for outsiders. A cancelled link and a file in the trash open nothing.
 */
export async function resolveShare(db: Db, token: string) {
  const [row] = await db
    .select({ fileId: files.id, folderId: files.folderId, deletedAt: files.deletedAt })
    .from(fileShares)
    .innerJoin(files, eq(files.id, fileShares.fileId))
    .where(eq(fileShares.tokenHash, hashToken(token)));
  if (!row || row.deletedAt) throw new ShareError('NOT_FOUND');
  try {
    await folderPath(db, row.folderId);
  } catch (error) {
    if (error instanceof FileError) throw new ShareError('NOT_FOUND');
    throw error;
  }
  return { fileId: row.fileId, folderId: row.folderId };
}

/** The editor of an HTML file in Súbory: its frame, and whether it is small enough to edit. */
export async function editInfo(db: Db, env: Env, fileId: string) {
  const file = await liveFile(db, fileId);
  if (fileExtension(file.name) !== 'html') throw new ShareError('NOT_HTML');
  const [version] = await db
    .select({ size: fileVersions.size })
    .from(fileVersions)
    .where(eq(fileVersions.id, file.currentVersionId!));
  const canEdit = (version?.size ?? 0) <= SHARE_LIMITS.editableBytes;
  return {
    versionId: file.currentVersionId!,
    canEdit,
    frame: `/share-frame/${frameToken(env, {
      kind: 'version',
      id: file.currentVersionId!,
      mode: canEdit ? 'edit' : 'comment',
    })}`,
  };
}

export async function colleagueFragment(
  db: Db,
  storage: Storage | null,
  fileId: string,
  block: number,
) {
  if (!storage) throw new ShareError('NOT_FOUND');
  const file = await liveFile(db, fileId);
  const source = await versionSource(db, storage, file.currentVersionId!, fileId);
  const fragment = fragmentForEditor(source, block);
  if (!fragment) throw new ShareError('NOT_EDITABLE');
  return { ...fragment, styles: documentStyles(source) };
}

/** The open comments with their replies, as the public page has them. `own`: theirs to change. */
export async function colleagueComments(
  db: Db,
  input: { fileId: string; sessionId: string },
  userId: string,
) {
  const file = await liveFile(db, input.fileId);
  const rows = await db
    .select()
    .from(fileComments)
    .where(and(eq(fileComments.fileId, input.fileId), isNull(fileComments.deletedAt)))
    .orderBy(asc(fileComments.createdAt));
  return rows
    .filter((row) => row.parentId === null && row.agreedAt === null)
    .map((row) => ({
      id: row.id,
      anchor: row.anchor,
      body: row.body,
      authorName: row.authorName,
      createdAt: row.createdAt,
      own: row.userId === userId,
      sameVersion: row.versionId === file.currentVersionId,
      thisVisit: row.sessionId === input.sessionId,
      replies: rows
        .filter((reply) => reply.parentId === row.id)
        .map((reply) => ({
          id: reply.id,
          body: reply.body,
          authorName: reply.authorName,
          colleague: reply.userId !== null,
          createdAt: reply.createdAt,
          thisVisit: reply.sessionId === input.sessionId,
        })),
    }));
}

async function nameOf(db: Db | Tx, userId: string) {
  const [user] = await db
    .select({ name: fullNameOf(users) })
    .from(users)
    .where(eq(users.id, userId));
  return user?.name ?? '';
}

/** A colleague's draft: the same list and approval as any other, and no activity. */
async function createColleagueDraft(
  tx: Tx,
  values: {
    fileId: string;
    baseVersionId: string;
    sessionId: string;
    userId: string;
    name: string;
  },
) {
  const [draft] = await tx
    .insert(fileDrafts)
    .values({
      fileId: values.fileId,
      baseVersionId: values.baseVersionId,
      sessionId: values.sessionId,
      authorNames: [values.name],
      createdByUserId: values.userId,
    })
    .returning({ id: fileDrafts.id });
  return draft!.id;
}

/** Saved at once; the first of a visit without a waiting draft makes one, as a visitor's does. */
export async function colleagueAddComment(
  db: Db,
  userId: string,
  input: {
    fileId: string;
    sessionId: string;
    body: string;
    anchor?: CommentAnchor | null | undefined;
    parentId?: string | null | undefined;
  },
) {
  return db.transaction(async (tx) => {
    const file = await liveFile(tx, input.fileId);
    if (input.parentId) {
      const [parent] = await tx
        .select({ id: fileComments.id, parentId: fileComments.parentId })
        .from(fileComments)
        .where(
          and(
            eq(fileComments.id, input.parentId),
            eq(fileComments.fileId, input.fileId),
            isNull(fileComments.deletedAt),
          ),
        );
      if (!parent || parent.parentId) throw new ShareError('NOT_FOUND');
    }
    const name = await nameOf(tx, userId);
    const [comment] = await tx
      .insert(fileComments)
      .values({
        fileId: input.fileId,
        versionId: file.currentVersionId!,
        parentId: input.parentId ?? null,
        anchor: input.parentId ? null : (input.anchor ?? null),
        body: input.body,
        userId,
        sessionId: input.sessionId,
        authorName: name,
      })
      .returning({ id: fileComments.id });
    if (input.parentId) return { id: comment!.id, reply: true };
    const waiting = await waitingOfVisit(tx, input.fileId, input.sessionId);
    const drafts = waiting.length
      ? waiting
      : [
          await createColleagueDraft(tx, {
            fileId: input.fileId,
            baseVersionId: file.currentVersionId!,
            sessionId: input.sessionId,
            userId,
            name,
          }),
        ];
    await tx
      .insert(fileDraftComments)
      .values(drafts.map((draftId) => ({ draftId, commentId: comment!.id })));
    return { id: comment!.id, reply: false };
  });
}

async function waitingOfVisit(tx: Tx, fileId: string, sessionId: string) {
  const rows = await tx
    .select({ id: fileDrafts.id })
    .from(fileDrafts)
    .where(
      and(
        eq(fileDrafts.fileId, fileId),
        eq(fileDrafts.sessionId, sessionId),
        eq(fileDrafts.state, 'waiting'),
      ),
    );
  return rows.map((row) => row.id);
}

/** Their own, while nobody has agreed to it. */
async function ownCommentOf(tx: Tx, userId: string, id: string) {
  const [comment] = await tx
    .select()
    .from(fileComments)
    .where(and(eq(fileComments.id, id), isNull(fileComments.deletedAt)))
    .for('update');
  if (!comment) throw new ShareError('NOT_FOUND');
  if (comment.userId !== userId || comment.agreedAt) throw new ShareError('NOT_YOURS');
  return comment;
}

export async function colleagueEditComment(db: Db, userId: string, id: string, body: string) {
  return db.transaction(async (tx) => {
    const comment = await ownCommentOf(tx, userId, id);
    await tx
      .update(fileComments)
      .set({ body, updatedAt: new Date() })
      .where(eq(fileComments.id, id));
    return { fileId: comment.fileId };
  });
}

export async function colleagueDeleteComment(db: Db, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const comment = await ownCommentOf(tx, userId, id);
    await dropComment(tx, comment);
    return { fileId: comment.fileId };
  });
}

/**
 * „Uložiť ako koncept“ or „Uložiť ako novú verziu“. A version only while this visit wrote no comment:
 * a comment waits for an answer, which a version has no place for. On a newer version, changes whose
 * fragment is unchanged apply to it, and if any does not fit nothing is saved and the page says so.
 */
export async function saveEdits(
  db: Db,
  storage: Storage | null,
  userId: string,
  input: {
    fileId: string;
    sessionId: string;
    baseVersionId: string;
    mode: 'version' | 'draft';
    ops: ChangeOp[];
  },
) {
  if (!storage) throw new ShareError('NOT_FOUND');
  const file = await liveFile(db, input.fileId);
  const source = await versionSource(db, storage, input.baseVersionId, input.fileId);
  if (Buffer.byteLength(source, 'utf8') > SHARE_LIMITS.editableBytes) {
    throw new ShareError('TOO_LARGE');
  }
  const changes = preparedChanges(source, input.ops);
  const name = await nameOf(db, userId);

  if (input.mode === 'draft') {
    return db.transaction(async (tx) => {
      const [empty] = await tx
        .select({ id: fileDrafts.id })
        .from(fileDrafts)
        .where(
          and(
            eq(fileDrafts.fileId, input.fileId),
            eq(fileDrafts.sessionId, input.sessionId),
            eq(fileDrafts.state, 'waiting'),
            sql`not exists (select 1 from file_draft_changes c where c.draft_id = ${fileDrafts.id})`,
          ),
        );
      const draftId =
        empty?.id ??
        (await createColleagueDraft(tx, {
          fileId: input.fileId,
          baseVersionId: input.baseVersionId,
          sessionId: input.sessionId,
          userId,
          name,
        }));
      if (empty) {
        await tx
          .update(fileDrafts)
          .set({ baseVersionId: input.baseVersionId })
          .where(eq(fileDrafts.id, empty.id));
      }
      await tx.insert(fileDraftChanges).values(
        changes.map((change) => ({
          draftId,
          block: change.fragment.block,
          kind: change.kind,
          oldHtml: change.oldHtml,
          newHtml: change.newHtml,
          authorName: name,
        })),
      );
      const own = await tx
        .select({ id: fileComments.id })
        .from(fileComments)
        .where(
          and(
            eq(fileComments.fileId, input.fileId),
            eq(fileComments.sessionId, input.sessionId),
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
      return { kind: 'draft' as const, draftId };
    });
  }

  const [wrote] = await db
    .select({ id: fileComments.id })
    .from(fileComments)
    .where(
      and(
        eq(fileComments.fileId, input.fileId),
        eq(fileComments.sessionId, input.sessionId),
        isNull(fileComments.deletedAt),
      ),
    )
    .limit(1);
  if (wrote) throw new ShareError('HAS_COMMENTS');

  const current = file.currentVersionId!;
  let target = source;
  let placed = changes.map((change) => ({
    block: change.fragment.block,
    html: change.newHtml,
  }));
  if (current !== input.baseVersionId) {
    target = await versionSource(db, storage, current, input.fileId);
    const resolved = resolveChanges(
      target,
      changes.map((change, i) => ({
        id: String(i),
        oldHtml: change.oldHtml,
        newHtml: change.newHtml,
      })),
    );
    if (resolved.unplaced.length > 0) {
      const [newest] = await db
        .select({ number: fileVersions.number })
        .from(fileVersions)
        .where(inArray(fileVersions.id, [current]));
      return {
        kind: 'unfit' as const,
        version: newest?.number ?? 0,
        count: resolved.unplaced.length,
      };
    }
    placed = resolved.placed.map((change) => ({ block: change.block, html: change.newHtml }));
  }
  const version = await addVersionFromBytes(db, storage, {
    fileId: input.fileId,
    bytes: new TextEncoder().encode(applyChanges(target, placed)),
    userId,
    via: 'web',
  });
  return { kind: 'version' as const, number: version.number, versionId: version.versionId };
}
