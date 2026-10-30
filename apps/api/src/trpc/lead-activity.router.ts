import {
  interestTokenSchema,
  leadActivityIdSchema,
  leadActivityListSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as leadActivities from '../activities/lead-activities.service.js';
import { loadEnv } from '../config/env.js';
import { RATE_LIMITS } from '../security/rate-limit.js';
import { authorizedProcedure, limitPerIp, publicProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof leadActivities.LeadActivityError)) throw error;
    throw new TRPCError({ code: 'NOT_FOUND', message: error.code });
  }
}

/** The main menu's „Aktivity“ (docs/activities.md): read, and removed when it was only a test. */
export const leadActivityRouter = router({
  list: authorizedProcedure('activity.read')
    .input(leadActivityListSchema)
    .query(({ ctx, input }) => leadActivities.listLeadActivities(ctx.db, input)),

  get: authorizedProcedure('activity.read')
    .input(leadActivityIdSchema)
    .query(({ ctx, input }) => run(() => leadActivities.getLeadActivity(ctx.db, input.id))),

  delete: authorizedProcedure('activity.delete')
    .input(leadActivityIdSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await run(() => leadActivities.deleteLeadActivity(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'leadActivity',
        entityId: row.id,
        diff: { type: row.type, productId: row.productId, deleted: true },
      });
      return { ok: true as const };
    }),
});

/**
 * The public page behind an e-mail's interest button (no sign-in): the token from the link's
 * fragment. Rate limited per address like every other one-time token.
 */
export const interestRouter = router({
  info: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .meta({ audit: false })
    .input(interestTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const info = await leadActivities.interestInfo(ctx.db, loadEnv(), input.token);
      if (!info) throw new TRPCError({ code: 'NOT_FOUND' });
      return info;
    }),

  confirm: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .input(interestTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const done = await leadActivities.confirmInterest(ctx.db, loadEnv(), input.token);
      if (!done) throw new TRPCError({ code: 'NOT_FOUND' });
      ctx.audit.set({
        entityType: 'leadActivity',
        diff: {
          type: 'product_interest',
          productId: done.productId,
          customerId: done.organizationId,
          ...(done.contactId ? { contactId: done.contactId } : {}),
          repeated: done.repeated,
        },
      });
      return { repeated: done.repeated };
    }),
});
