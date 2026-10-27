import { assignInboundSchema, inboundIdSchema, inboundListSchema } from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as inbound from '../inbound/inbound.service.js';
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
