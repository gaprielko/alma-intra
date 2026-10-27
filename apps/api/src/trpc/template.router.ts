import {
  confirmImageSchema,
  emailLookSchema,
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

  /** The look, and the sending address it is shown with (read-only, from the environment). */
  look: authorizedProcedure('template.read').query(async ({ ctx }) => ({
    look: await templates.getLook(ctx.db),
    senderAddress: ctx.env.CAMPAIGN_FROM_ADDRESS,
  })),

  lookPreview: authorizedProcedure('template.read')
    .input(emailLookSchema)
    .query(({ ctx, input }) =>
      templates.previewLook(ctx.db, ctx.env.WEB_URL, ctx.session.userId, input),
    ),

  updateLook: authorizedProcedure('email_look.manage')
    .input(emailLookSchema)
    .mutation(async ({ ctx, input }) => {
      const { fields } = await templates.updateLook(ctx.db, ctx.session.userId, input);
      ctx.audit.set({ entityType: 'email_look', diff: { fields } });
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

  confirmImage: authorizedProcedure('template.write')
    .input(confirmImageSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() => images.confirmImage(ctx.db, ctx.storage, input.id));
      ctx.audit.set({ entityType: 'email_image', entityId: input.id });
      return result;
    }),
});
