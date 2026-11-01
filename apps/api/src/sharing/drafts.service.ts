import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Db, Tx } from '../db/db.module.js';
import {
  auditEvents,
  fileComments,
  fileDraftChanges,
  fileDraftComments,
  fileDrafts,
  files,
  fileVersions,
  fullNameOf,
  leadActivities,
  users,
} from '../db/schema/index.js';
import { addVersionFromBytes, liveFile } from '../files/files.service.js';
import type { Storage } from '../storage/storage.js';
import {
  applyChanges,
  framePage,
  type PlacedChange,
  resolveChanges,
  safeNewHtml,
} from './share-html.js';
import { frameToken } from './share-tokens.js';
import { ShareError } from './shares.service.js';

type Change = typeof fileDraftChanges.$inferSelect;

async function sourceOf(db: Db | Tx, storage: Storage, versionId: string) {
  const [version] = await db
    .select({ key: fileVersions.storageKey })
    .from(fileVersions)
    .where(eq(fileVersions.id, versionId));
  if (!version) throw new ShareError('NOT_FOUND');
  return new TextDecoder().decode(await storage.read(version.key));
}

/** What a draft asks of a colleague: only comments are counted, a reply needs no decision. */
const openRoots = (draftId: string) =>
  sql<number>`(select count(*)::int from file_draft_comments dc join file_comments c on c.id = dc.comment_id
    where dc.draft_id = ${draftId} and c.deleted_at is null and c.parent_id is null and c.agreed_at is null)`;

/** „Koncepty“ of a file, newest first. */
export async function listDrafts(db: Db, fileId: string) {
  const rows = await db
    .select({
      id: fileDrafts.id,
      state: fileDrafts.state,
      authorNames: fileDrafts.authorNames,
      createdAt: fileDrafts.createdAt,
      mergedIntoId: fileDrafts.mergedIntoId,
      baseNumber: fileVersions.number,
      versionNumber: sql<
        number | null
      >`(select v.number from file_versions v where v.id = ${fileDrafts.versionId})`,
      changes: sql<number>`(select count(*)::int from file_draft_changes c where c.draft_id = ${fileDrafts.id})`,
      pendingChanges: sql<number>`(select count(*)::int from file_draft_changes c where c.draft_id = ${fileDrafts.id} and c.decision = 'pending')`,
      comments: sql<number>`(select count(*)::int from file_draft_comments dc join file_comments c on c.id = dc.comment_id
        where dc.draft_id = ${fileDrafts.id} and c.deleted_at is null and c.parent_id is null)`,
      openComments: sql<number>`(select count(*)::int from file_draft_comments dc join file_comments c on c.id = dc.comment_id
        where dc.draft_id = ${fileDrafts.id} and c.deleted_at is null and c.parent_id is null and c.agreed_at is null)`,
    })
    .from(fileDrafts)
    .innerJoin(fileVersions, eq(fileVersions.id, fileDrafts.baseVersionId))
    .where(eq(fileDrafts.fileId, fileId))
    .orderBy(desc(fileDrafts.createdAt))
    .limit(200);
  return rows;
}

async function draftRow(db: Db | Tx, id: string) {
  const [draft] = await db.select().from(fileDrafts).where(eq(fileDrafts.id, id));
  if (!draft) throw new ShareError('NOT_FOUND');
  return draft;
}

async function draftChanges(db: Db | Tx, id: string) {
  return db
    .select()
    .from(fileDraftChanges)
    .where(eq(fileDraftChanges.draftId, id))
    .orderBy(asc(fileDraftChanges.block));
}

/** Each change, where it now fits in the file's current version, and what is left to decide. */
function placeChanges(source: string, changes: Change[]) {
  const { placed, unplaced } = resolveChanges(
    source,
    changes.map((c) => ({ id: c.id, oldHtml: c.oldHtml, newHtml: c.newHtml })),
  );
  const blockOf = new Map(placed.map((p) => [p.id, p.block]));
  const unplacedIds = new Set(unplaced.map((u) => u.id));
  return {
    rows: changes.map((change) => ({
      ...change,
      block: blockOf.get(change.id) ?? null,
      fits: !unplacedIds.has(change.id),
    })),
    remaining: changes.filter((c) =>
      unplacedIds.has(c.id) ? c.decision !== 'rejected' : c.decision === 'pending',
    ).length,
  };
}

/** What a draft's frame shows: the first not rejected of each fragment, an approved one above all. */
function shownChanges(rows: ReturnType<typeof placeChanges>['rows']): PlacedChange[] {
  const ordered = rows
    .filter((c) => c.block !== null && c.decision !== 'rejected')
    .sort((a, b) => (a.decision === 'approved' ? -1 : 0) - (b.decision === 'approved' ? -1 : 0));
  return ordered.map((c) => ({ id: c.id, block: c.block!, html: c.newHtml }));
}

/**
 * What a draft is read against: a waiting one against the file as it is now, as that is where its
 * changes would go; one already settled against the version it came from.
 */
const versionToRead = (
  draft: { state: string; baseVersionId: string },
  file: { currentVersionId: string | null },
) => (draft.state === 'waiting' ? file.currentVersionId! : draft.baseVersionId);

/** A draft for its screen: the changes placed in the current version, the comments, and what is left. */
export async function draftDetail(db: Db, env: Env, storage: Storage | null, id: string) {
  const draft = await draftRow(db, id);
  if (!storage) throw new ShareError('NOT_FOUND');
  const file = await liveFile(db, draft.fileId);
  const changes = await draftChanges(db, id);
  const source = await sourceOf(db, storage, versionToRead(draft, file));
  const { rows, remaining } = placeChanges(source, changes);
  const comments = await commentsOfDraft(db, id, file.currentVersionId!);
  const [base] = await db
    .select({ number: fileVersions.number })
    .from(fileVersions)
    .where(eq(fileVersions.id, draft.baseVersionId));
  const [made] = draft.versionId
    ? await db
        .select({ number: fileVersions.number })
        .from(fileVersions)
        .where(eq(fileVersions.id, draft.versionId))
    : [];
  const openComments = comments.filter((c) => !c.agreedAt).length;
  return {
    id: draft.id,
    fileId: draft.fileId,
    fileName: file.name,
    state: draft.state,
    authorNames: draft.authorNames,
    createdAt: draft.createdAt,
    mergedIntoId: draft.mergedIntoId,
    baseNumber: base?.number ?? null,
    versionNumber: made?.number ?? null,
    frame: `/share-frame/${frameToken(env, { kind: 'draft', id: draft.id, mode: 'draft' })}`,
    changes: rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      oldHtml: c.oldHtml,
      newHtml: c.newHtml,
      authorName: c.authorName,
      decision: c.decision,
      block: c.block,
      fits: c.fits,
    })),
    comments,
    remainingChanges: remaining,
    remainingComments: openComments,
    approved: rows.filter((c) => c.fits && c.decision === 'approved').length,
  };
}

async function commentsOfDraft(db: Db | Tx, draftId: string, currentVersionId: string) {
  const roots = await db
    .select({ comment: fileComments, agreedBy: fullNameOf(users) })
    .from(fileDraftComments)
    .innerJoin(fileComments, eq(fileComments.id, fileDraftComments.commentId))
    .leftJoin(users, eq(users.id, fileComments.agreedByUserId))
    .where(
      and(
        eq(fileDraftComments.draftId, draftId),
        isNull(fileComments.deletedAt),
        isNull(fileComments.parentId),
      ),
    )
    .orderBy(asc(fileComments.createdAt));
  const ids = roots.map((r) => r.comment.id);
  const replies = ids.length
    ? await db
        .select()
        .from(fileComments)
        .where(and(inArray(fileComments.parentId, ids), isNull(fileComments.deletedAt)))
        .orderBy(asc(fileComments.createdAt))
    : [];
  return roots.map(({ comment, agreedBy }) => ({
    id: comment.id,
    anchor: comment.anchor,
    body: comment.body,
    authorName: comment.authorName,
    createdAt: comment.createdAt,
    agreedAt: comment.agreedAt,
    agreedBy,
    sameVersion: comment.versionId === currentVersionId,
    replies: replies
      .filter((r) => r.parentId === comment.id)
      .map((r) => ({
        id: r.id,
        body: r.body,
        authorName: r.authorName,
        colleague: r.userId !== null,
        createdAt: r.createdAt,
      })),
  }));
}

/** The frame's page of a draft (`share-frame.controller`). */
export async function draftFramePage(db: Db, storage: Storage, id: string) {
  const draft = await draftRow(db, id);
  const file = await liveFile(db, draft.fileId);
  const source = await sourceOf(db, storage, versionToRead(draft, file));
  const { rows } = placeChanges(source, await draftChanges(db, id));
  return framePage(source, { mode: 'draft', changes: shownChanges(rows) });
}

async function waitingDraft(tx: Tx, id: string) {
  const [draft] = await tx.select().from(fileDrafts).where(eq(fileDrafts.id, id)).for('update');
  if (!draft) throw new ShareError('NOT_FOUND');
  if (draft.state !== 'waiting') throw new ShareError('NOT_WAITING');
  return draft;
}

/**
 * „Schváliť“, „Zamietnuť“, or back. Alternatives of one fragment exclude each other: approving one
 * rejects the rest. A change that no longer fits can only be rejected.
 */
export async function decideChange(
  db: Db,
  storage: Storage | null,
  userId: string,
  changeId: string,
  decision: 'approved' | 'rejected' | 'pending',
) {
  if (!storage) throw new ShareError('NOT_FOUND');
  return db.transaction(async (tx) => {
    const [change] = await tx
      .select()
      .from(fileDraftChanges)
      .where(eq(fileDraftChanges.id, changeId));
    if (!change) throw new ShareError('NOT_FOUND');
    const draft = await waitingDraft(tx, change.draftId);
    const file = await liveFile(tx, draft.fileId);
    const all = await draftChanges(tx, draft.id);
    const source = await sourceOf(tx, storage, file.currentVersionId!);
    const { rows } = placeChanges(source, all);
    const row = rows.find((r) => r.id === changeId)!;
    if (decision === 'approved' && !row.fits) throw new ShareError('NOT_READY');
    const now = new Date();
    const decided = (value: 'approved' | 'rejected' | 'pending') => ({
      decision: value,
      decidedByUserId: value === 'pending' ? null : userId,
      decidedAt: value === 'pending' ? null : now,
    });
    await tx
      .update(fileDraftChanges)
      .set(decided(decision))
      .where(eq(fileDraftChanges.id, changeId));
    if (decision === 'approved') {
      const others = rows
        .filter((r) => r.id !== changeId && r.block === row.block && r.decision !== 'rejected')
        .map((r) => r.id);
      if (others.length > 0) {
        await tx
          .update(fileDraftChanges)
          .set(decided('rejected'))
          .where(inArray(fileDraftChanges.id, others));
      }
    }
    return { draftId: draft.id, fileId: draft.fileId };
  });
}

/** A comment any of whose drafts is open, for a colleague's answer or agreement. */
async function commentForColleague(tx: Tx, id: string) {
  const [comment] = await tx
    .select()
    .from(fileComments)
    .where(and(eq(fileComments.id, id), isNull(fileComments.deletedAt)))
    .for('update');
  if (!comment) throw new ShareError('NOT_FOUND');
  return comment;
}

/** A colleague's answer: shows on the public page, under the colleague's name. */
export async function replyComment(db: Db, userId: string, commentId: string, body: string) {
  return db.transaction(async (tx) => {
    const parent = await commentForColleague(tx, commentId);
    if (parent.parentId) throw new ShareError('NOT_FOUND');
    const [user] = await tx
      .select({ name: fullNameOf(users) })
      .from(users)
      .where(eq(users.id, userId));
    const [reply] = await tx
      .insert(fileComments)
      .values({
        fileId: parent.fileId,
        versionId: parent.versionId,
        parentId: parent.id,
        body,
        userId,
        authorName: user?.name ?? '',
      })
      .returning({ id: fileComments.id });
    return { id: reply!.id, fileId: parent.fileId };
  });
}

/**
 * „Odsúhlasiť“, or back. A draft of only comments is finished when the last of them is agreed to;
 * going back does not reopen one.
 */
export async function agreeComment(db: Db, userId: string, commentId: string, agreed: boolean) {
  return db.transaction(async (tx) => {
    const comment = await commentForColleague(tx, commentId);
    if (comment.parentId) throw new ShareError('NOT_FOUND');
    await tx
      .update(fileComments)
      .set({
        agreedAt: agreed ? new Date() : null,
        agreedByUserId: agreed ? userId : null,
        updatedAt: new Date(),
      })
      .where(eq(fileComments.id, commentId));
    if (!agreed) return { fileId: comment.fileId };
    const holding = await tx
      .select({ id: fileDrafts.id })
      .from(fileDraftComments)
      .innerJoin(fileDrafts, eq(fileDrafts.id, fileDraftComments.draftId))
      .where(and(eq(fileDraftComments.commentId, commentId), eq(fileDrafts.state, 'waiting')));
    for (const { id } of holding) {
      await tx
        .update(fileDrafts)
        .set({ state: 'finished', finishedAt: new Date() })
        .where(
          and(
            eq(fileDrafts.id, id),
            sql`not exists (select 1 from file_draft_changes c where c.draft_id = ${id})`,
            sql`${openRoots(id)} = 0`,
          ),
        );
    }
    return { fileId: comment.fileId };
  });
}

/** „Zahodiť“: the changes stay readable; comments of the draft stay on the file. */
export async function discardDraft(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const draft = await waitingDraft(tx, id);
    await tx
      .update(fileDrafts)
      .set({ state: 'discarded', finishedAt: new Date() })
      .where(eq(fileDrafts.id, id));
    return { fileId: draft.fileId };
  });
}

/**
 * „Zlúčiť“: a new draft on the current version holding all of them. The same change twice becomes
 * one and keeps the decision made on it; different changes of one fragment stay as alternatives. Its
 * sources turn into „Zlúčený“, and their activities lead on to the new draft through `mergedIntoId`.
 */
export async function mergeDrafts(db: Db, userId: string, fileId: string, ids: string[]) {
  return db.transaction(async (tx) => {
    const file = await liveFile(tx, fileId, true);
    const sources = await tx
      .select()
      .from(fileDrafts)
      .where(and(eq(fileDrafts.fileId, fileId), inArray(fileDrafts.id, ids)))
      .for('update');
    if (sources.length !== new Set(ids).size || sources.some((d) => d.state !== 'waiting')) {
      throw new ShareError('NOT_WAITING');
    }
    const [merged] = await tx
      .insert(fileDrafts)
      .values({
        fileId,
        baseVersionId: file.currentVersionId!,
        authorNames: [...new Set(sources.flatMap((d) => d.authorNames))],
        createdByUserId: userId,
      })
      .returning({ id: fileDrafts.id });
    const changes = await tx
      .select()
      .from(fileDraftChanges)
      .where(inArray(fileDraftChanges.draftId, ids))
      .orderBy(asc(fileDraftChanges.block));
    const unique = new Map<string, Change>();
    for (const change of changes) {
      const key = JSON.stringify([change.oldHtml, change.newHtml]);
      const known = unique.get(key);
      if (!known || (known.decision === 'pending' && change.decision !== 'pending')) {
        unique.set(key, change);
      }
    }
    if (unique.size > 0) {
      await tx.insert(fileDraftChanges).values(
        [...unique.values()].map((change) => ({
          draftId: merged!.id,
          block: change.block,
          kind: change.kind,
          oldHtml: change.oldHtml,
          newHtml: change.newHtml,
          authorName: change.authorName,
          decision: change.decision,
          decidedByUserId: change.decidedByUserId,
          decidedAt: change.decidedAt,
        })),
      );
    }
    const comments = await tx
      .selectDistinct({ commentId: fileDraftComments.commentId })
      .from(fileDraftComments)
      .where(inArray(fileDraftComments.draftId, ids));
    if (comments.length > 0) {
      await tx
        .insert(fileDraftComments)
        .values(comments.map((c) => ({ draftId: merged!.id, commentId: c.commentId })));
    }
    await tx
      .update(fileDrafts)
      .set({ state: 'merged', mergedIntoId: merged!.id, finishedAt: new Date() })
      .where(inArray(fileDrafts.id, ids));
    return { id: merged!.id, changes: unique.size, comments: comments.length };
  });
}

/**
 * „Vytvoriť novú verziu“: only when every change is decided and every comment agreed to. The file is
 * the current version with the approved changes, each through the sanitizer again. All rejected:
 * the draft is finished and no version is made.
 */
export async function finishDraft(db: Db, storage: Storage | null, userId: string, id: string) {
  if (!storage) throw new ShareError('NOT_FOUND');
  const draft = await draftRow(db, id);
  if (draft.state !== 'waiting') throw new ShareError('NOT_WAITING');
  const file = await liveFile(db, draft.fileId);
  const source = await sourceOf(db, storage, file.currentVersionId!);
  const changes = await draftChanges(db, id);
  const { rows, remaining } = placeChanges(source, changes);
  const [open] = await db.select({ count: openRoots(id) }).from(sql`(select 1) as one`);
  if (remaining > 0 || (open?.count ?? 0) > 0) throw new ShareError('NOT_READY');
  const approved = rows.filter((c) => c.decision === 'approved' && c.block !== null);
  if (approved.length === 0) {
    await db
      .update(fileDrafts)
      .set({ state: 'finished', finishedAt: new Date() })
      .where(eq(fileDrafts.id, id));
    return { fileId: draft.fileId, version: null, versionId: null };
  }
  const next = applyChanges(
    source,
    approved.map((c) => ({
      block: c.block!,
      html: c.newHtml === null ? null : safeNewHtml(c.newHtml, c.oldHtml),
    })),
  );
  const version = await addVersionFromBytes(db, storage, {
    fileId: draft.fileId,
    bytes: new TextEncoder().encode(next),
    userId,
    via: 'share',
    externalAuthor: draft.authorNames.join(', '),
  });
  await db
    .update(fileDrafts)
    .set({ state: 'finished', versionId: version.versionId, finishedAt: new Date() })
    .where(eq(fileDrafts.id, id));
  return { fileId: draft.fileId, version: version.number, versionId: version.versionId };
}

/** The drafts a draft came from, itself included. */
async function draftChain(db: Db, id: string) {
  const result = await db.execute<{ id: string }>(sql`
    with recursive chain as (
      select id from file_drafts where id = ${id}
      union
      select d.id from file_drafts d join chain on d.merged_into_id = chain.id
    )
    select id from chain`);
  return result.rows.map((row) => row.id);
}

/** The dated trail of an activity: what happened to the draft and to those it was merged from. */
export async function draftTrail(db: Db, id: string) {
  const ids = await draftChain(db, id);
  const rows = await db
    .select({
      at: auditEvents.at,
      action: auditEvents.action,
      diff: auditEvents.diff,
      userName: users.name,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.userId))
    .where(
      and(
        eq(auditEvents.entityType, 'fileDraft'),
        inArray(auditEvents.entityId, ids),
        sql`${auditEvents.action} not like '%.failed' and ${auditEvents.action} not like '%.denied'`,
      ),
    )
    .orderBy(asc(auditEvents.at))
    .limit(200);
  return rows as {
    at: Date;
    action: string;
    diff: Record<string, unknown> | null;
    userName: string | null;
  }[];
}

/** Where an activity's draft is now: the last of its merges. */
export async function draftOfActivity(db: Db, activityId: string) {
  const [row] = await db
    .select({ draft: fileDrafts, fileName: files.name })
    .from(leadActivities)
    .innerJoin(fileDrafts, eq(fileDrafts.id, leadActivities.fileDraftId))
    .innerJoin(files, eq(files.id, fileDrafts.fileId))
    .where(eq(leadActivities.id, activityId));
  if (!row) return null;
  let current = row.draft;
  for (let hops = 0; current.mergedIntoId && hops < 50; hops += 1) {
    current = await draftRow(db, current.mergedIntoId);
  }
  const [counts] = await db
    .select({
      changes: sql<number>`(select count(*)::int from file_draft_changes c where c.draft_id = ${row.draft.id})`,
      comments: sql<number>`(select count(*)::int from file_draft_comments dc where dc.draft_id = ${row.draft.id})`,
    })
    .from(sql`(select 1) as one`);
  const [made] = current.versionId
    ? await db
        .select({ number: fileVersions.number })
        .from(fileVersions)
        .where(eq(fileVersions.id, current.versionId))
    : [];
  return {
    draftId: current.id,
    fileId: row.draft.fileId,
    fileName: row.fileName,
    authorNames: row.draft.authorNames,
    state: current.state,
    versionNumber: made?.number ?? null,
    changes: counts?.changes ?? 0,
    comments: counts?.comments ?? 0,
    trail: await draftTrail(db, row.draft.id),
  };
}

/** The open comments of a file for its preview, each with a waiting draft that holds it. */
export async function openCommentsOfFile(db: Db, fileId: string) {
  const roots = await db
    .select({
      id: fileComments.id,
      anchor: fileComments.anchor,
      body: fileComments.body,
      authorName: fileComments.authorName,
      createdAt: fileComments.createdAt,
      draftId: sql<string | null>`(select dc.draft_id from file_draft_comments dc
        join file_drafts d on d.id = dc.draft_id
        where dc.comment_id = ${fileComments.id} and d.state = 'waiting'
        order by d.created_at desc limit 1)`,
    })
    .from(fileComments)
    .where(
      and(
        eq(fileComments.fileId, fileId),
        isNull(fileComments.deletedAt),
        isNull(fileComments.parentId),
        isNull(fileComments.agreedAt),
      ),
    )
    .orderBy(asc(fileComments.createdAt))
    .limit(200);
  return roots;
}
