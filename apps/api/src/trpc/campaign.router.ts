import {
  campaignContentSchema,
  campaignIdSchema,
  campaignListSchema,
  chooseTemplateSchema,
  createCampaignSchema,
  messagePreviewSchema,
  recipientCandidatesSchema,
  recipientContentSchema,
  sendCampaignSchema,
  setRecipientsSchema,
  unsubscribeSchema,
  unsubscribeTokenSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as campaigns from '../campaigns/campaigns.service.js';
import { dropForUnsubscribed, setUnsubscribed, unsubscribeInfo } from '../campaigns/delivery.js';
import { MailProviderError } from '../mail/transport.js';
import { RATE_LIMITS } from '../security/rate-limit.js';
import { authorizedProcedure, limitPerIp, publicProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof campaigns.CampaignError)) throw error;
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'NOT_DRAFT' || error.code === 'NOT_SCHEDULED'
          ? 'CONFLICT'
          : error.code === 'STORAGE_NOT_CONFIGURED'
            ? 'PRECONDITION_FAILED'
            : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

/**
 * E-mails to customers (spec 6.4–6.8): the wizard's draft step by step, the preview per
 * recipient, a test to oneself, sending, and the sent overview.
 */
export const campaignRouter = router({
  list: authorizedProcedure('email.read')
    .input(campaignListSchema)
    .query(({ ctx, input }) => campaigns.listCampaigns(ctx.db, input.status, input.page)),

  get: authorizedProcedure('email.read')
    .input(campaignIdSchema)
    .query(({ ctx, input }) => run(() => campaigns.getCampaign(ctx.db, input.id))),

  candidates: authorizedProcedure('email.send')
    .input(recipientCandidatesSchema)
    .query(({ ctx, input }) => campaigns.recipientCandidates(ctx.db, input.customerIds)),

  preview: authorizedProcedure('email.read')
    .input(messagePreviewSchema)
    .query(({ ctx, input }) =>
      run(() => campaigns.previewMessage(ctx.db, ctx.env, input.messageId)),
    ),

  create: authorizedProcedure('email.send')
    .input(createCampaignSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() =>
        campaigns.createCampaign(ctx.db, ctx.session.userId, input.customerIds),
      );
      ctx.audit.set({
        entityType: 'campaign',
        entityId: created.id,
        diff: { count: input.customerIds.length },
      });
      return created;
    }),

  setRecipients: authorizedProcedure('email.send')
    .input(setRecipientsSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => campaigns.setRecipients(ctx.db, input.id, input.recipients));
      ctx.audit.set({
        entityType: 'campaign',
        entityId: input.id,
        diff: { count: input.recipients.length },
      });
      return { ok: true as const };
    }),

  chooseTemplate: authorizedProcedure('email.send')
    .input(chooseTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => campaigns.chooseTemplate(ctx.db, input.id, input.templateId));
      ctx.audit.set({
        entityType: 'campaign',
        entityId: input.id,
        diff: { templateId: input.templateId },
      });
      return { ok: true as const };
    }),

  saveContent: authorizedProcedure('email.send')
    .input(campaignContentSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => campaigns.saveContent(ctx.db, input));
      ctx.audit.set({ entityType: 'campaign', entityId: input.id, diff: { fields: ['content'] } });
      return { ok: true as const };
    }),

  saveRecipient: authorizedProcedure('email.send')
    .input(recipientContentSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => campaigns.saveRecipientContent(ctx.db, input));
      ctx.audit.set({
        entityType: 'campaign',
        diff: {
          messageId: input.messageId,
          edited: input.bodyOverride !== undefined && input.bodyOverride !== null,
        },
      });
      return { ok: true as const };
    }),

  deleteDraft: authorizedProcedure('email.send')
    .input(campaignIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => campaigns.deleteDraft(ctx.db, input.id));
      ctx.audit.set({ entityType: 'campaign', entityId: input.id, diff: { deleted: true } });
      return { ok: true as const };
    }),

  /** „Poslať test“: the first recipient's e-mail to the sender's own address, now. */
  sendTest: authorizedProcedure('email.send')
    .input(campaignIdSchema)
    .mutation(async ({ ctx, input }) => {
      const mail = await run(() => campaigns.testMessage(ctx.db, ctx.env, input.id));
      try {
        await ctx.campaignTransport.send({
          to: mail.to,
          from: mail.from,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
      } catch (error) {
        if (error instanceof MailProviderError) {
          throw new TRPCError({ code: 'BAD_GATEWAY', message: 'PROVIDER' });
        }
        throw error;
      }
      ctx.audit.set({ entityType: 'campaign', entityId: input.id, diff: { test: true } });
      return { sentTo: mail.to, missing: mail.missing };
    }),

  /** „Odoslať“: every e-mail rendered, stored and queued, now or at a time; the worker sends them. */
  send: authorizedProcedure('email.send')
    .input(sendCampaignSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        campaigns.queueCampaign(
          ctx.db,
          ctx.env,
          input.id,
          input.at ? new Date(input.at) : undefined,
        ),
      );
      ctx.audit.set({
        entityType: 'campaign',
        entityId: input.id,
        diff: {
          count: result.queued,
          skipped: result.skipped,
          ...(result.scheduledAt ? { scheduled: true } : {}),
        },
      });
      return result;
    }),

  /** „Zrušiť naplánovanie“: back to a draft before it starts. */
  unschedule: authorizedProcedure('email.send')
    .input(campaignIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => campaigns.unscheduleCampaign(ctx.db, input.id));
      ctx.audit.set({ entityType: 'campaign', entityId: input.id, diff: { unscheduled: true } });
      return { ok: true as const };
    }),
});

/**
 * The public unsubscribe page (no sign-in): the token from the link's fragment. Rate limited per
 * address like every other one-time token.
 */
export const unsubscribeRouter = router({
  info: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .meta({ audit: false })
    .input(unsubscribeTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const info = await unsubscribeInfo(ctx.db, input.token);
      if (!info) throw new TRPCError({ code: 'NOT_FOUND' });
      return info;
    }),

  confirm: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .input(unsubscribeSchema)
    .mutation(async ({ ctx, input }) => {
      const changed = await setUnsubscribed(ctx.db, input.token, true);
      if (!changed) throw new TRPCError({ code: 'NOT_FOUND' });
      await dropForUnsubscribed(ctx.db, changed);
      ctx.audit.set({
        entityType: 'customer',
        entityId: changed.customerId,
        diff: {
          contact: 'unsubscribed',
          ...(changed.contactId ? { contactId: changed.contactId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
      });
      return { ok: true as const };
    }),

  undo: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .input(unsubscribeTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const changed = await setUnsubscribed(ctx.db, input.token, false);
      if (!changed) throw new TRPCError({ code: 'NOT_FOUND' });
      ctx.audit.set({
        entityType: 'customer',
        entityId: changed.customerId,
        diff: {
          contact: 'resubscribed',
          ...(changed.contactId ? { contactId: changed.contactId } : {}),
        },
      });
      return { ok: true as const };
    }),
});
