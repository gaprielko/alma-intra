import {
  companySchema,
  confirmImageSchema,
  effectiveLookSchema,
  emailSettingsSchema,
  imageFromFileSchema,
  lookFieldsSchema,
  lookKindSchema,
  saveLookSchema,
  requestImageSchema,
  templateIdSchema,
  templateInputSchema,
  templateListSchema,
  templatePreviewSchema,
  updateTemplateSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as images from '../email/images.service.js';
import * as templates from '../email/templates.service.js';
import { MailProviderError } from '../mail/transport.js';
import { authorizedProcedure, router } from './trpc.js';

/** The services' refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof templates.TemplateError) {
      throw new TRPCError({
        code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
        message: error.code,
      });
    }
    if (error instanceof images.ImageError) {
      throw new TRPCError({
        code:
          error.code === 'NOT_FOUND'
            ? 'NOT_FOUND'
            : error.code === 'STORAGE_NOT_CONFIGURED'
              ? 'PRECONDITION_FAILED'
              : 'BAD_REQUEST',
        message: error.code,
      });
    }
    throw error;
  }
}

/**
 * E-mail templates (spec 6.3): the list, the editor, duplicates, a preview filled for a contact;
 * the company look of every e-mail; and the images e-mails show.
 */
export const templateRouter = router({
  list: authorizedProcedure('template.read')
    .input(templateListSchema)
    .query(({ ctx, input }) => templates.listTemplates(ctx.db, input)),

  get: authorizedProcedure('template.read')
    .input(templateIdSchema)
    .query(({ ctx, input }) => run(() => templates.getTemplate(ctx.db, input.id))),

  create: authorizedProcedure('template.write')
    .input(templateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() => templates.createTemplate(ctx.db, ctx.session.userId, input));
      ctx.audit.set({
        entityType: 'email_template',
        entityId: created.id,
        diff: { categoryId: input.categoryId, active: input.active },
      });
      return created;
    }),

  update: authorizedProcedure('template.write')
    .input(updateTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() =>
        templates.updateTemplate(ctx.db, ctx.session.userId, input.id, input.template),
      );
      ctx.audit.set({
        entityType: 'email_template',
        entityId: input.id,
        diff: { fields: change.fields, active: change.active },
      });
      return { ok: true as const };
    }),

  duplicate: authorizedProcedure('template.write')
    .input(templateIdSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() =>
        templates.duplicateTemplate(ctx.db, ctx.session.userId, input.id),
      );
      ctx.audit.set({
        entityType: 'email_template',
        entityId: created.id,
        diff: { duplicatedFrom: input.id },
      });
      return created;
    }),

  previewContacts: authorizedProcedure('template.read').query(({ ctx }) =>
    templates.previewContacts(ctx.db),
  ),

  /** The exact HTML a recipient would get, for the template being edited (saved or not). */
  preview: authorizedProcedure('template.read')
    .input(templatePreviewSchema)
    .query(({ ctx, input }) =>
      templates.previewTemplate(ctx.db, ctx.env.WEB_URL, ctx.session.userId, input),
    ),

  /** „Poslať test“: the preview as it stands, to the signed-in user's own address. */
  sendTest: authorizedProcedure('email.send')
    .input(templatePreviewSchema)
    .mutation(async ({ ctx, input }) => {
      const mail = await templates.testTemplate(ctx.db, ctx.env, ctx.session.userId, input);
      try {
        await ctx.campaignTransport.send(mail);
      } catch (error) {
        if (error instanceof MailProviderError) {
          throw new TRPCError({ code: 'BAD_GATEWAY', message: 'PROVIDER' });
        }
        throw error;
      }
      ctx.audit.set({ entityType: 'email_template', diff: { test: true } });
      return { sentTo: mail.to };
    }),

  /**
   * The look, the sending address it is shown with and whether replies can come back to Intra
   * (both read-only, from the environment).
   */
  look: authorizedProcedure('template.read').query(async ({ ctx }) => ({
    look: await templates.getLook(ctx.db),
    senderAddress: ctx.env.CAMPAIGN_FROM_ADDRESS,
    inboundReady: Boolean(ctx.env.INBOUND_REPLY_DOMAIN && ctx.env.RESEND_API_KEY),
  })),

  /** The look an e-mail of this type with this product wears, for the editor's frame. */
  effectiveLook: authorizedProcedure('template.read')
    .input(effectiveLookSchema)
    .query(async ({ ctx, input }) => ({
      look: await templates.lookFor(ctx.db, input.kind, input.productId),
    })),

  /** The global look of a type, as it is edited. */
  globalLook: authorizedProcedure('template.read')
    .input(lookKindSchema)
    .query(({ ctx, input }) => templates.globalLook(ctx.db, input.kind)),

  productLooks: authorizedProcedure('template.read')
    .input(lookKindSchema)
    .query(({ ctx, input }) => templates.productLooks(ctx.db, input.kind)),

  saveLook: authorizedProcedure('email_look.manage')
    .input(saveLookSchema)
    .mutation(async ({ ctx, input }) => {
      const { fields } = await run(() => templates.saveLook(ctx.db, ctx.session.userId, input));
      ctx.audit.set({
        entityType: 'email_look',
        ...(input.productId ? { entityId: input.productId } : {}),
        diff: { kind: input.kind, enabled: input.enabled, fields },
      });
      return { ok: true as const };
    }),

  lookPreview: authorizedProcedure('template.read')
    .input(lookFieldsSchema)
    .query(({ ctx, input }) =>
      templates.previewLook(ctx.db, ctx.env.WEB_URL, ctx.session.userId, input),
    ),

  emailSettings: authorizedProcedure('template.read').query(({ ctx }) =>
    templates.getEmailSettings(ctx.db),
  ),

  updateEmailSettings: authorizedProcedure('email_look.manage')
    .input(emailSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const { fields } = await templates.updateEmailSettings(ctx.db, ctx.session.userId, input);
      ctx.audit.set({ entityType: 'email_look', diff: { fields } });
      return { ok: true as const };
    }),

  /** Settings › Firma. */
  company: authorizedProcedure('template.read').query(({ ctx }) => templates.getCompany(ctx.db)),

  updateCompany: authorizedProcedure('company.manage')
    .input(companySchema)
    .mutation(async ({ ctx, input }) => {
      const { fields } = await templates.updateCompany(ctx.db, ctx.session.userId, input);
      ctx.audit.set({ entityType: 'company', diff: { fields } });
      return { ok: true as const };
    }),

  requestImage: authorizedProcedure('template.write')
    .input(requestImageSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        images.requestImage(ctx.db, ctx.storage, ctx.session.userId, input),
      );
      ctx.audit.set({ entityType: 'email_image', entityId: result.id, diff: { size: input.size } });
      return result;
    }),

  /** A picture from Files, for a template's body or a look's logo. */
  imageFromFile: authorizedProcedure('template.write')
    .input(imageFromFileSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        images.imageFromFile(ctx.db, ctx.storage, ctx.session.userId, input.fileId),
      );
      ctx.audit.set({ entityType: 'email_image', diff: { fileId: input.fileId } });
      return result;
    }),

  confirmImage: authorizedProcedure('template.write')
    .input(confirmImageSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() => images.confirmImage(ctx.db, ctx.storage, input.id));
      ctx.audit.set({ entityType: 'email_image', entityId: input.id });
      return result;
    }),
});
