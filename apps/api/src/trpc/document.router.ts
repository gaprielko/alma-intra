import { createDocumentSchema } from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as documents from '../documents/documents.service.js';
import { FileError } from '../files/files.service.js';
import { authorizedProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof documents.DocumentError) {
      throw new TRPCError({
        code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
        message: error.code,
      });
    }
    if (error instanceof FileError) {
      throw new TRPCError({
        code: error.code === 'STORAGE_NOT_CONFIGURED' ? 'PRECONDITION_FAILED' : 'BAD_REQUEST',
        message: error.code,
      });
    }
    throw error;
  }
}

/** Document templates and „Vytvoriť dokument“ (spec 7.4). */
export const documentRouter = router({
  templates: authorizedProcedure('file.read').query(({ ctx }) => {
    if (!ctx.storage) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'STORAGE_NOT_CONFIGURED' });
    }
    return documents.listDocumentTemplates(ctx.db, ctx.storage);
  }),

  create: authorizedProcedure('file.write')
    .input(createDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() =>
        documents.createDocument(ctx.db, ctx.storage, ctx.session.userId, input),
      );
      ctx.audit.set({
        entityType: 'document',
        entityId: created.fileId,
        diff: { templateId: input.templateId, customerId: input.customerId },
      });
      return created;
    }),
});
