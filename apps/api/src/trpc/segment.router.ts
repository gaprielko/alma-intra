import { segmentIdSchema, segmentSchema, updateSegmentSchema } from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as segments from '../customers/segments.service.js';
import { authorizedProcedure, router } from './trpc.js';

/** Saved segments (D-7): the contact list's filters under a name, mine or shared. */
export const segmentRouter = router({
  list: authorizedProcedure('customer.read').query(({ ctx }) =>
    segments.listSegments(ctx.db, ctx.session.userId),
  ),

  create: authorizedProcedure('customer.read')
    .input(segmentSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await segments.createSegment(ctx.db, ctx.session.userId, input);
      ctx.audit.set({
        entityType: 'segment',
        entityId: created.id,
        diff: { shared: input.shared, filters: Object.keys(input.filters) },
      });
      return created;
    }),

  update: authorizedProcedure('customer.read')
    .input(updateSegmentSchema)
    .mutation(async ({ ctx, input }) => {
      if (!(await segments.updateSegment(ctx.db, ctx.session.userId, input))) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      ctx.audit.set({ entityType: 'segment', entityId: input.id, diff: { shared: input.shared } });
      return { ok: true as const };
    }),

  delete: authorizedProcedure('customer.read')
    .input(segmentIdSchema)
    .mutation(async ({ ctx, input }) => {
      if (!(await segments.deleteSegment(ctx.db, ctx.session.userId, input.id))) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      ctx.audit.set({ entityType: 'segment', entityId: input.id, diff: { deleted: true } });
      return { ok: true as const };
    }),

  /** The organizations it finds today, to add as an e-mail's recipients. */
  customerIds: authorizedProcedure('customer.read')
    .input(segmentIdSchema)
    .query(async ({ ctx, input }) => {
      const ids = await segments.segmentCustomerIds(ctx.db, ctx.session.userId, input.id);
      if (!ids) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ids, capped: ids.length === segments.SEGMENT_RECIPIENTS };
    }),
});
