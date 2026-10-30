import {
  assignInboundSchema,
  inboundIdSchema,
  inboundReadSchema,
  inboundListSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { Logger } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { saveInboundAttachments } from '../inbound/attachments.js';
import { importInbound, previewImport } from '../inbound/import.js';
import { InboundFetchError, inboundSource } from '../inbound/inbound.js';
import { syncInbound } from '../inbound/intake.js';
import * as inbound from '../inbound/inbound.service.js';
import { describeError } from '../logging/describe-error.js';
import { authorizedProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof inbound.InboundError)) throw error;
    throw new TRPCError({
      code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: error.code,
    });
  }
}

const logger = new Logger('inbound');

/**
 * Received e-mail (spec 6.6, 6.8 „Prijaté“): the list with the unassigned first, one e-mail, and
 * filing it under a customer or putting it aside.
 */
export const inboundRouter = router({
  list: authorizedProcedure('email.read')
    .input(inboundListSchema)
    .query(({ ctx, input }) => inbound.listInbound(ctx.db, input)),
  /** The rest of an e-mail's conversation, newest first. */
  thread: authorizedProcedure('email.read')
    .input(inboundIdSchema)
    .query(({ ctx, input }) => run(() => inbound.inboundThread(ctx.db, input.id))),
  /** The other conversations with the same person, newest first. */
  others: authorizedProcedure('email.read')
    .input(inboundIdSchema)
    .query(({ ctx, input }) => run(() => inbound.otherConversations(ctx.db, input.id))),

  get: authorizedProcedure('email.read')
    .input(inboundIdSchema)
    .query(({ ctx, input }) => run(() => inbound.getInbound(ctx.db, input.id))),

  assign: authorizedProcedure('email.read')
    .input(assignInboundSchema)
    .mutation(async ({ ctx, input }) => {
      const { before, sent } = await run(() =>
        inbound.assignInbound(ctx.db, ctx.session.userId, input),
      );
      // Its attachments go into the customer's folder now; the filing stands even if they fail.
      await saveInboundAttachments(ctx.db, ctx.storage, inboundSource(loadEnv()), input.id).catch(
        (error: unknown) =>
          logger.warn({
            msg: 'attachments of a received e-mail not saved',
            inboundId: input.id,
            ...describeError(error),
          }),
      );
      ctx.audit.set({
        entityType: 'inbound',
        entityId: input.id,
        diff: {
          customerId: { before: before.customerId, after: input.customerId },
          ...(input.contactId ? { contactId: input.contactId } : {}),
          status: { before: before.status, after: 'assigned' },
        },
      });
      // The user's own imported e-mail has left „Prijaté“ for „Odoslané“.
      return { ok: true, sent };
    }),

  /** „Pridaj do konverzácie“: what the forward holds, shown before anything is stored. */
  importPreview: authorizedProcedure('email.read')
    .input(inboundIdSchema)
    .query(({ ctx, input }) => run(() => previewImport(ctx.db, input.id, ctx.session.userId))),

  /** „Pridaj do konverzácie“: the forward becomes the original it carries. */
  importForward: authorizedProcedure('email.read')
    .input(inboundIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { outcome } = await run(() => importInbound(ctx.db, input.id, ctx.session.userId));
      // As on filing: the attachments go into the folder now; the import stands even if they fail.
      await saveInboundAttachments(ctx.db, ctx.storage, inboundSource(loadEnv()), input.id).catch(
        (error: unknown) =>
          logger.warn({
            msg: 'attachments of a received e-mail not saved',
            inboundId: input.id,
            ...describeError(error),
          }),
      );
      ctx.audit.set({ entityType: 'inbound', entityId: input.id, diff: { imported: outcome } });
      return { outcome };
    }),

  /** „Načítať nové“: e-mails the provider received that Intra does not have yet. */
  sync: authorizedProcedure('email.read').mutation(async ({ ctx }) => {
    const source = inboundSource(loadEnv());
    if (!source) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'not_configured' });
    const { added } = await syncInbound(ctx.db, ctx.storage, source, logger).catch(
      (error: unknown) => {
        if (!(error instanceof InboundFetchError)) throw error;
        // Mostly a key without „Full access“: it may send, not read received mail.
        logger.warn({ msg: 'received e-mails not synced', providerCode: error.providerCode });
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'provider_refused' });
      },
    );
    ctx.audit.set({ entityType: 'inbound', diff: { synced: added } });
    return { added };
  }),

  discard: authorizedProcedure('email.read')
    .input(inboundIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { customerId } = await run(() => inbound.discardInbound(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'inbound',
        entityId: input.id,
        diff: { status: { after: 'discarded' }, ...(customerId ? { customerId } : {}) },
      });
      return { ok: true };
    }),

  discardThread: authorizedProcedure('email.read')
    .input(inboundIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { count } = await run(() => inbound.discardInboundThread(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'inbound',
        entityId: input.id,
        diff: { status: { after: 'discarded' }, count },
      });
      return { ok: true };
    }),

  markRead: authorizedProcedure('email.read')
    .input(inboundReadSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => inbound.markInboundRead(ctx.db, input.id, input.read));
      ctx.audit.set({ entityType: 'inbound', entityId: input.id, diff: { read: input.read } });
      return { ok: true };
    }),
});
