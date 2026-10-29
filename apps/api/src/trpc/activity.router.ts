import {
  activityIdSchema,
  createActivitySchema,
  customerIdSchema,
  nextStepDoneSchema,
  pickableFilesSchema,
  timelineSchema,
  updateActivitySchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import * as activitiesService from '../activities/activities.service.js';
import { authorizedProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof activitiesService.ActivityError)) throw error;
    const code =
      error.code === 'NOT_FOUND' || error.code === 'CUSTOMER_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'STORAGE_NOT_CONFIGURED'
          ? 'PRECONDITION_FAILED'
          : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

/**
 * Activities (D-8): calls, meetings, video calls and notes with a customer, their next steps
 * (D-23) and attachments, and the customer's timeline. Anyone may edit an activity (D-24); every
 * change is an audit event of the activity.
 */
export const activityRouter = router({
  timeline: authorizedProcedure('activity.read')
    .input(timelineSchema)
    .query(({ ctx, input }) =>
      run(() =>
        activitiesService.timeline(
          ctx.db,
          input.customerId,
          input.filter,
          input.withEstablishments,
        ),
      ),
    ),

  get: authorizedProcedure('activity.read')
    .input(activityIdSchema)
    .query(({ ctx, input }) => run(() => activitiesService.getActivity(ctx.db, input.id))),

  history: authorizedProcedure('activity.read')
    .input(activityIdSchema)
    .query(({ ctx, input }) => activitiesService.activityHistory(ctx.db, input.id)),

  /** The customer's contacts and the colleagues, for the dialog. */
  options: authorizedProcedure('activity.read')
    .input(customerIdSchema)
    .query(({ ctx, input }) => run(() => activitiesService.activityOptions(ctx.db, input.id))),

  myNextSteps: authorizedProcedure('activity.read').query(({ ctx }) =>
    activitiesService.myNextSteps(ctx.db, ctx.session.userId),
  ),

  pickableFiles: authorizedProcedure('file.read')
    .input(pickableFilesSchema)
    .query(({ ctx, input }) =>
      run(() =>
        activitiesService.pickableFiles(ctx.db, input.scope, input.customerId, input.search),
      ),
    ),

  /** „Kde je použitý“ on a file's sheet. */
  fileUsage: authorizedProcedure('file.read')
    .input(z.object({ fileId: z.string().uuid() }))
    .query(({ ctx, input }) => activitiesService.fileUsage(ctx.db, input.fileId)),

  create: authorizedProcedure('activity.write')
    .input(createActivitySchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() =>
        activitiesService.createActivity(
          ctx.db,
          ctx.session.userId,
          input.customerId,
          input.activity,
        ),
      );
      ctx.audit.set({
        entityType: 'activity',
        entityId: created.id,
        diff: {
          customerId: created.organizationId,
          kind: input.activity.kind,
          contacts: created.contacts,
          attachments: created.attachments,
          nextStep: input.activity.nextStep !== null,
        },
      });
      return { id: created.id };
    }),

  update: authorizedProcedure('activity.write')
    .input(updateActivitySchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() =>
        activitiesService.updateActivity(ctx.db, input.id, input.activity),
      );
      ctx.audit.set({
        entityType: 'activity',
        entityId: input.id,
        diff: {
          customerId: change.customerId,
          fields: change.fields,
          contacts: change.contacts,
          attachments: change.attachments,
        },
      });
      return { ok: true as const };
    }),

  delete: authorizedProcedure('activity.delete')
    .input(activityIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { customerId } = await run(() => activitiesService.deleteActivity(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'activity',
        entityId: input.id,
        diff: { customerId, deleted: true },
      });
      return { ok: true as const };
    }),

  setNextStepDone: authorizedProcedure('activity.write')
    .input(nextStepDoneSchema)
    .mutation(async ({ ctx, input }) => {
      const { customerId } = await run(() =>
        activitiesService.setNextStepDone(ctx.db, ctx.session.userId, input.id, input.done),
      );
      ctx.audit.set({
        entityType: 'activity',
        entityId: input.id,
        diff: { customerId, nextStepDone: input.done },
      });
      return { ok: true as const };
    }),

  /** An attached version, through the activity; audited like a download of the file. */
  attachmentUrl: authorizedProcedure('file.read')
    .input(
      z.object({
        activityId: z.string().uuid(),
        versionId: z.string().uuid(),
        inline: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        activitiesService.attachmentUrl(
          ctx.db,
          ctx.storage,
          input.activityId,
          input.versionId,
          input.inline,
        ),
      );
      ctx.audit.set({
        entityType: 'file',
        entityId: result.fileId,
        diff: { versionId: input.versionId, inline: input.inline },
      });
      return { url: result.url };
    }),
});
