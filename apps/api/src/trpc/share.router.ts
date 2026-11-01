import {
  addCommentSchema,
  deleteCommentSchema,
  draftCommentSchema,
  draftDecisionSchema,
  draftIdSchema,
  draftReplySchema,
  editCommentSchema,
  fragmentSchema,
  mergeDraftsSchema,
  publicShareSchema,
  saveDraftSchema,
  saveShareSchema,
  shareFileIdSchema,
  unlockShareSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { FileError } from '../files/files.service.js';
import { hit, ipSubject, RATE_LIMITS, refund } from '../security/rate-limit.js';
import * as drafts from '../sharing/drafts.service.js';
import * as shares from '../sharing/shares.service.js';
import { authorizedProcedure, limitPerIp, publicProcedure, router } from './trpc.js';

const CODES: Record<shares.ShareError['code'], TRPCError['code']> = {
  NOT_FOUND: 'NOT_FOUND',
  // Not UNAUTHORIZED: to the web client that means „the colleague's session ran out“.
  LOCKED: 'PRECONDITION_FAILED',
  WRONG_PASSWORD: 'FORBIDDEN',
  NAME_REQUIRED: 'BAD_REQUEST',
  NOT_ALLOWED: 'FORBIDDEN',
  PASSWORD_REQUIRED: 'BAD_REQUEST',
  NOT_HTML: 'BAD_REQUEST',
  NOT_EDITABLE: 'BAD_REQUEST',
  TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  NOT_YOURS: 'FORBIDDEN',
  NOT_WAITING: 'CONFLICT',
  NOT_READY: 'CONFLICT',
};

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof shares.ShareError) {
      throw new TRPCError({ code: CODES[error.code], message: error.code });
    }
    if (error instanceof FileError) {
      const code = error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST';
      throw new TRPCError({ code, message: error.code });
    }
    throw error;
  }
}

/** A file's public link and what came back through it, for a colleague. */
export const fileShareRouter = router({
  get: authorizedProcedure('file.share')
    .input(shareFileIdSchema)
    .query(({ ctx, input }) => run(() => shares.shareOf(ctx.db, ctx.env, input.fileId))),

  save: authorizedProcedure('file.share')
    .input(saveShareSchema)
    .mutation(async ({ ctx, input }) => {
      const saved = await run(() => shares.saveShare(ctx.db, ctx.env, ctx.session.userId, input));
      ctx.audit.set({
        entityType: 'fileShare',
        entityId: saved.id,
        diff: {
          fileId: input.fileId,
          mode: input.mode,
          hasPassword: saved.hasPassword,
          hasExpiry: saved.expiresAt !== null,
          passwordChanged: saved.passwordChanged,
        },
      });
      return run(() => shares.shareOf(ctx.db, ctx.env, input.fileId));
    }),

  cancel: authorizedProcedure('file.share')
    .input(shareFileIdSchema)
    .mutation(async ({ ctx, input }) => {
      const gone = await run(() => shares.cancelShare(ctx.db, input.fileId));
      ctx.audit.set({
        entityType: 'fileShare',
        entityId: gone.id,
        diff: { fileId: input.fileId, cancelled: true },
      });
      return { ok: true as const };
    }),

  drafts: authorizedProcedure('file.read')
    .input(shareFileIdSchema)
    .query(({ ctx, input }) => drafts.listDrafts(ctx.db, input.fileId)),

  comments: authorizedProcedure('file.read')
    .input(shareFileIdSchema)
    .query(({ ctx, input }) => drafts.openCommentsOfFile(ctx.db, input.fileId)),

  draft: authorizedProcedure('file.read')
    .input(draftIdSchema)
    .query(({ ctx, input }) =>
      run(() => drafts.draftDetail(ctx.db, ctx.env, ctx.storage, input.id)),
    ),

  decide: authorizedProcedure('file.share')
    .input(draftDecisionSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        drafts.decideChange(
          ctx.db,
          ctx.storage,
          ctx.session.userId,
          input.changeId,
          input.decision,
        ),
      );
      ctx.audit.set({
        entityType: 'fileDraft',
        entityId: result.draftId,
        diff: { fileId: result.fileId, changeId: input.changeId, decision: input.decision },
      });
      return { ok: true as const };
    }),

  reply: authorizedProcedure('file.share')
    .input(draftReplySchema.extend({ draftId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        drafts.replyComment(ctx.db, ctx.session.userId, input.commentId, input.body),
      );
      ctx.audit.set({
        entityType: 'fileDraft',
        entityId: input.draftId,
        diff: { fileId: result.fileId, commentId: input.commentId, reply: true },
      });
      return { ok: true as const };
    }),

  agree: authorizedProcedure('file.share')
    .input(draftCommentSchema.extend({ draftId: z.string().uuid(), agreed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        drafts.agreeComment(ctx.db, ctx.session.userId, input.commentId, input.agreed),
      );
      ctx.audit.set({
        entityType: 'fileDraft',
        entityId: input.draftId,
        diff: { fileId: result.fileId, commentId: input.commentId, agreed: input.agreed },
      });
      return { ok: true as const };
    }),

  discard: authorizedProcedure('file.share')
    .input(draftIdSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() => drafts.discardDraft(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'fileDraft',
        entityId: input.id,
        diff: { fileId: result.fileId, discarded: true },
      });
      return { ok: true as const };
    }),

  merge: authorizedProcedure('file.share')
    .input(mergeDraftsSchema)
    .mutation(async ({ ctx, input }) => {
      const merged = await run(() =>
        drafts.mergeDrafts(ctx.db, ctx.session.userId, input.fileId, input.ids),
      );
      ctx.audit.set({
        entityType: 'fileDraft',
        entityId: merged.id,
        diff: {
          fileId: input.fileId,
          mergedFrom: input.ids.length,
          changes: merged.changes,
          comments: merged.comments,
        },
      });
      return { id: merged.id };
    }),

  finish: authorizedProcedure('file.share')
    .input(draftIdSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        drafts.finishDraft(ctx.db, ctx.storage, ctx.session.userId, input.id),
      );
      ctx.audit.set({
        entityType: 'fileDraft',
        entityId: input.id,
        diff: {
          fileId: result.fileId,
          finished: true,
          version: result.version,
          versionId: result.versionId,
        },
      });
      return result;
    }),
});

const shareProcedure = publicProcedure.use(limitPerIp(RATE_LIMITS.sharePerIp));

/**
 * The page behind a public link, without a sign-in (docs/file-sharing.md). All mutations: the link's
 * token travels in POST bodies, and a query would put it into the address. What only reads leaves no
 * audit event: no tracking of who opened a link ([S-33]). `ctx.session` is never read here.
 */
export const publicShareRouter = router({
  info: shareProcedure
    .meta({ audit: false })
    .input(publicShareSchema)
    .mutation(({ ctx, input }) =>
      run(() => shares.accessInfo(ctx.db, ctx.env, ctx.req, input.token)),
    ),

  unlock: shareProcedure
    .meta({ audit: false })
    .input(unlockShareSchema)
    .mutation(async ({ ctx, input }) => {
      const live = await run(() => shares.liveShare(ctx.db, input.token));
      const perIp = RATE_LIMITS.shareUnlockPerIp;
      const perLink = RATE_LIMITS.shareUnlockPerLink;
      const ipHit = await hit(ctx.db, perIp, ipSubject(ctx.req.ip));
      const linkHit = await hit(ctx.db, perLink, live.share.id);
      if (ipHit.count > perIp.limit || linkHit.count > perLink.limit) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      await run(() => shares.unlock(ctx.db, ctx.env, ctx.req, ctx.res, live, input));
      // Only a wrong password counts.
      await refund(ctx.db, perIp, ipSubject(ctx.req.ip), ipHit);
      await refund(ctx.db, perLink, live.share.id, linkHit);
      return { ok: true as const };
    }),

  forget: shareProcedure
    .meta({ audit: false })
    .input(publicShareSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => shares.forgetVisitor(ctx.db, ctx.res, input.token));
      return { ok: true as const };
    }),

  open: shareProcedure
    .meta({ audit: false })
    .input(publicShareSchema)
    .mutation(({ ctx, input }) =>
      run(async () => {
        const opened = await shares.openedShare(ctx.db, ctx.env, ctx.req, input.token);
        return shares.openFile(ctx.db, ctx.env, opened);
      }),
    ),

  download: shareProcedure
    .meta({ audit: false })
    .input(publicShareSchema.extend({ inline: z.boolean().default(false) }))
    .mutation(({ ctx, input }) =>
      run(async () => {
        const opened = await shares.openedShare(ctx.db, ctx.env, ctx.req, input.token);
        return shares.fileUrl(ctx.db, ctx.storage, opened, input.inline);
      }),
    ),

  fragment: shareProcedure
    .meta({ audit: false })
    .input(fragmentSchema)
    .mutation(({ ctx, input }) =>
      run(async () => {
        const opened = await shares.openedShare(ctx.db, ctx.env, ctx.req, input.token, 'edit');
        return shares.fragmentFor(ctx.db, ctx.storage, opened, input.block);
      }),
    ),

  saveDraft: shareProcedure.input(saveDraftSchema).mutation(async ({ ctx, input }) => {
    const opened = await run(() =>
      shares.openedShare(ctx.db, ctx.env, ctx.req, input.token, 'edit'),
    );
    const rule = RATE_LIMITS.shareSavePerLink;
    if ((await hit(ctx.db, rule, opened.share.id)).count > rule.limit) {
      ctx.audit.set({ skipFailureAudit: true });
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }
    const saved = await run(() => shares.saveDraft(ctx.db, ctx.storage, opened, input));
    ctx.audit.set({
      entityType: 'fileDraft',
      entityId: saved.draftId,
      diff: { fileId: opened.file.id, changes: saved.changes, comments: saved.comments },
    });
    return { draftId: saved.draftId };
  }),

  comments: shareProcedure
    .meta({ audit: false })
    .input(publicShareSchema)
    .mutation(({ ctx, input }) =>
      run(async () => {
        const opened = await shares.openedShare(ctx.db, ctx.env, ctx.req, input.token, 'comment');
        return shares.publicComments(ctx.db, opened);
      }),
    ),

  addComment: shareProcedure.input(addCommentSchema).mutation(async ({ ctx, input }) => {
    const opened = await run(() =>
      shares.openedShare(ctx.db, ctx.env, ctx.req, input.token, 'comment'),
    );
    const rule = RATE_LIMITS.shareCommentPerLink;
    if ((await hit(ctx.db, rule, opened.share.id)).count > rule.limit) {
      ctx.audit.set({ skipFailureAudit: true });
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }
    const added = await run(() => shares.addComment(ctx.db, opened, input));
    ctx.audit.set({
      entityType: 'fileComment',
      entityId: added.id,
      diff: { fileId: opened.file.id, reply: added.reply },
    });
    return { id: added.id };
  }),

  editComment: shareProcedure.input(editCommentSchema).mutation(async ({ ctx, input }) => {
    const opened = await run(() =>
      shares.openedShare(ctx.db, ctx.env, ctx.req, input.token, 'comment'),
    );
    await run(() => shares.editComment(ctx.db, opened, input.id, input.body));
    ctx.audit.set({
      entityType: 'fileComment',
      entityId: input.id,
      diff: { fileId: opened.file.id, edited: true },
    });
    return { ok: true as const };
  }),

  deleteComment: shareProcedure.input(deleteCommentSchema).mutation(async ({ ctx, input }) => {
    const opened = await run(() =>
      shares.openedShare(ctx.db, ctx.env, ctx.req, input.token, 'comment'),
    );
    await run(() => shares.deleteComment(ctx.db, opened, input.id));
    ctx.audit.set({
      entityType: 'fileComment',
      entityId: input.id,
      diff: { fileId: opened.file.id, deleted: true },
    });
    return { ok: true as const };
  }),
});
