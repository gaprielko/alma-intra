import {
  assignInboundSchema,
  inboundIdSchema,
  inboundListSchema,
  replyInboundSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { Logger } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { saveInboundAttachments } from '../inbound/attachments.js';
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

  get: authorizedProcedure('email.read')
    .input(inboundIdSchema)
    .query(({ ctx, input }) => run(() => inbound.getInbound(ctx.db, input.id))),

  assign: authorizedProcedure('email.read')
    .input(assignInboundSchema)
    .mutation(async ({ ctx, input }) => {
      const { before } = await run(() => inbound.assignInbound(ctx.db, ctx.session.userId, input));
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
      return { ok: true };
    }),

  /** „Odpovedať“: the answer is queued like any e-mail to a customer and leaves within seconds. */
  reply: authorizedProcedure('email.send')
    .input(replyInboundSchema)
    .mutation(async ({ ctx, input }) => {
      const { campaignId } = await run(() =>
        inbound.replyToInbound(ctx.db, ctx.session.userId, input),
      );
      ctx.audit.set({ entityType: 'inbound', entityId: input.id, diff: { campaignId } });
      return { campaignId };
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
});
