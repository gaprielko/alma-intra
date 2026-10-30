import {
  activityTypeCreateSchema,
  activityTypeUpdateSchema,
  interestTokenSchema,
  leadActivityAssignSchema,
  leadActivityIdSchema,
  leadActivityListSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as activityTypes from '../activities/activity-types.service.js';
import * as leadActivities from '../activities/lead-activities.service.js';
import { writeAuditEvent } from '../audit/audit.js';
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

  /** A podnet's text and picture: a sensitive read, so it leaves a trace of who opened it. */
  feedback: authorizedProcedure('activity.read')
    .input(leadActivityIdSchema)
    .query(async ({ ctx, input }) => {
      const content = await run(() =>
        leadActivities.getFeedbackContent(ctx.db, ctx.storage, input.id),
      );
      ctx.audit.set({ entityType: 'leadActivity', entityId: input.id, diff: { source: 'app' } });
      await writeAuditEvent({
        db: ctx.db,
        req: ctx.req,
        requestId: ctx.requestId,
        path: 'leadActivity.feedback',
        kind: 'read',
        input: null,
        result: null,
        trail: ctx.audit,
        sessionUserId: ctx.session.userId,
      });
      return content;
    }),

  assign: authorizedProcedure('activity.write')
    .input(leadActivityAssignSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...target } = input;
      const row = await run(() => leadActivities.assignLeadActivity(ctx.db, id, target));
      ctx.audit.set({
        entityType: 'leadActivity',
        entityId: row.id,
        diff: {
          typeId: row.typeId,
          ...(input.organizationId ? { customerId: input.organizationId } : {}),
          ...(input.contactId ? { contactId: input.contactId } : {}),
          assigned: true,
        },
      });
      return { ok: true as const };
    }),

  delete: authorizedProcedure('activity.delete')
    .input(leadActivityIdSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await run(() => leadActivities.deleteLeadActivity(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'leadActivity',
        entityId: row.id,
        diff: {
          typeId: row.typeId,
          ...(row.productId ? { productId: row.productId } : {}),
          deleted: true,
        },
      });
      return { ok: true as const };
    }),
});

async function runType<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof activityTypes.ActivityTypeError)) throw error;
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'NAME_TAKEN'
          ? 'CONFLICT'
          : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

/** Aktivity › Typy aktivít (docs/activity-types.md). */
export const activityTypeRouter = router({
  list: authorizedProcedure('activity_type.read').query(({ ctx }) =>
    activityTypes.listActivityTypes(ctx.db),
  ),

  create: authorizedProcedure('activity_type.write')
    .input(activityTypeCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await runType(() => activityTypes.createActivityType(ctx.db, input));
      ctx.audit.set({
        entityType: 'activityType',
        entityId: created.id,
        diff: { created: true },
      });
      return created;
    }),

  update: authorizedProcedure('activity_type.write')
    .input(activityTypeUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...values } = input;
      const { fields } = await runType(() => activityTypes.updateActivityType(ctx.db, id, values));
      ctx.audit.set({ entityType: 'activityType', entityId: id, diff: { fields } });
      return { ok: true as const };
    }),

  delete: authorizedProcedure('activity_type.write')
    .input(leadActivityIdSchema)
    .mutation(async ({ ctx, input }) => {
      await runType(() => activityTypes.deleteActivityType(ctx.db, input.id));
      ctx.audit.set({ entityType: 'activityType', entityId: input.id, diff: { deleted: true } });
      return { ok: true as const };
    }),
});

/**
 * The public page behind an e-mail's button that records an activity (no sign-in): the token from
 * the link's fragment. Rate limited per address like every other one-time token.
 */
export const interestRouter = router({
  info: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .meta({ audit: false })
    .input(interestTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const info = await leadActivities.activityInfo(ctx.db, loadEnv(), input.token);
      if (!info) throw new TRPCError({ code: 'NOT_FOUND' });
      return info;
    }),

  confirm: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .input(interestTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const done = await leadActivities.confirmActivity(ctx.db, loadEnv(), input.token);
      if (!done) throw new TRPCError({ code: 'NOT_FOUND' });
      ctx.audit.set({
        entityType: 'leadActivity',
        diff: {
          typeId: done.typeId,
          ...(done.productId ? { productId: done.productId } : {}),
          customerId: done.organizationId,
          ...(done.contactId ? { contactId: done.contactId } : {}),
          repeated: done.repeated,
        },
      });
      return { repeated: done.repeated };
    }),
});
