import {
  createFolderSchema,
  customerFoldersSchema,
  describeFileSchema,
  downloadFileSchema,
  FILE_TYPES,
  fileExtension,
  fileIdSchema,
  folderContentsSchema,
  folderIdSchema,
  moveFileSchema,
  moveFolderSchema,
  renameFileSchema,
  renameFolderSchema,
  requestUploadSchema,
  requestVersionSchema,
  restoreVersionSchema,
  versionIdSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import * as filesService from '../files/files.service.js';
import { authorizedProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof filesService.FileError)) throw error;
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'STORAGE_NOT_CONFIGURED'
          ? 'PRECONDITION_FAILED'
          : error.code === 'NAME_TAKEN' || error.code === 'FOLDER_NOT_EMPTY'
            ? 'CONFLICT'
            : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

const groupOf = (name: string) => {
  const ext = fileExtension(name);
  return ext ? FILE_TYPES[ext].group : null;
};

/**
 * Súbory: the company's folders and the customers', files with their versions, uploads straight
 * to the bucket, downloads and previews by signed URL, and the trash.
 */
export const fileRouter = router({
  /** Whether uploads work at all: without S3 variables the page says so instead. */
  status: authorizedProcedure('file.read').query(({ ctx }) => ({
    configured: ctx.storage !== null,
  })),

  tree: authorizedProcedure('file.read').query(({ ctx }) => filesService.companyTree(ctx.db)),

  customerFolders: authorizedProcedure('file.read')
    .input(customerFoldersSchema.extend({ all: z.boolean().default(false) }))
    .query(({ ctx, input }) =>
      filesService.customerFolders(ctx.db, input.search, input.all || input.search ? 200 : 5),
    ),

  /** The folder of a customer, for a link from the customer's detail. */
  customerFolder: authorizedProcedure('file.read')
    .input(z.object({ customerId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      run(async () => ({ id: await filesService.customerRootFolderId(ctx.db, input.customerId) })),
    ),

  customerFiles: authorizedProcedure('file.read')
    .input(z.object({ customerId: z.string().uuid() }))
    .query(({ ctx, input }) => run(() => filesService.customerFiles(ctx.db, input.customerId))),

  contents: authorizedProcedure('file.read')
    .input(folderContentsSchema)
    .query(({ ctx, input }) => run(() => filesService.folderContents(ctx.db, input))),

  authors: authorizedProcedure('file.read').query(({ ctx }) => filesService.fileAuthors(ctx.db)),

  get: authorizedProcedure('file.read')
    .input(fileIdSchema)
    .query(({ ctx, input }) => run(() => filesService.fileDetail(ctx.db, input.id))),

  history: authorizedProcedure('file.read')
    .input(fileIdSchema)
    .query(({ ctx, input }) => filesService.fileHistory(ctx.db, input.id)),

  trash: authorizedProcedure('file.read').query(({ ctx }) => filesService.trashList(ctx.db)),

  /**
   * A mutation, not a query: every download or preview of a file leaves a trace in the audit
   * trail (which file and version, never its name).
   */
  download: authorizedProcedure('file.read')
    .input(downloadFileSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() => filesService.downloadUrl(ctx.db, ctx.storage, input));
      ctx.audit.set({
        entityType: 'file',
        entityId: input.id,
        diff: { versionId: result.versionId, version: result.number, inline: result.inline },
      });
      return { url: result.url, inline: result.inline };
    }),

  requestUpload: authorizedProcedure('file.write')
    .input(requestUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        filesService.requestUpload(ctx.db, ctx.storage, ctx.session.userId, input),
      );
      ctx.audit.set({
        entityType: 'file',
        entityId: result.fileId,
        diff: {
          folderId: input.folderId,
          versionId: result.versionId,
          size: input.size,
          group: groupOf(input.name),
        },
      });
      return result;
    }),

  requestVersion: authorizedProcedure('file.write')
    .input(requestVersionSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        filesService.requestVersion(ctx.db, ctx.storage, ctx.session.userId, input),
      );
      ctx.audit.set({
        entityType: 'file',
        entityId: result.fileId,
        diff: { versionId: result.versionId, size: input.size },
      });
      return result;
    }),

  confirmUpload: authorizedProcedure('file.write')
    .input(versionIdSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        filesService.confirmUpload(ctx.db, ctx.storage, input.versionId),
      );
      ctx.audit.set({
        entityType: 'file',
        entityId: result.fileId,
        diff: { versionId: input.versionId, version: result.number },
      });
      return result;
    }),

  rename: authorizedProcedure('file.write')
    .input(renameFileSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => filesService.renameFile(ctx.db, input.id, input.name));
      ctx.audit.set({
        entityType: 'file',
        entityId: input.id,
        diff: { fields: ['name'], group: groupOf(input.name) },
      });
      return { ok: true as const };
    }),

  describe: authorizedProcedure('file.write')
    .input(describeFileSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => filesService.describeFile(ctx.db, input.id, input.description));
      ctx.audit.set({ entityType: 'file', entityId: input.id, diff: { fields: ['description'] } });
      return { ok: true as const };
    }),

  move: authorizedProcedure('file.write')
    .input(moveFileSchema)
    .mutation(async ({ ctx, input }) => {
      const moved = await run(() => filesService.moveFile(ctx.db, input.id, input.folderId));
      ctx.audit.set({
        entityType: 'file',
        entityId: input.id,
        diff: {
          fields: ['folderId'],
          folderId: { before: moved.from, after: input.folderId },
          customerId: moved.customerId,
        },
      });
      return { ok: true as const };
    }),

  restoreVersion: authorizedProcedure('file.write')
    .input(restoreVersionSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() =>
        filesService.restoreVersion(ctx.db, ctx.storage, ctx.session.userId, input.versionId),
      );
      ctx.audit.set({
        entityType: 'file',
        entityId: result.fileId,
        diff: { version: result.number, restoredFrom: result.restoredFrom },
      });
      return result;
    }),

  trashFile: authorizedProcedure('file.delete')
    .input(fileIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => filesService.trashFile(ctx.db, ctx.session.userId, input.id));
      ctx.audit.set({ entityType: 'file', entityId: input.id, diff: { trashed: true } });
      return { ok: true as const };
    }),

  restoreFile: authorizedProcedure('file.delete')
    .input(fileIdSchema)
    .mutation(async ({ ctx, input }) => {
      const restored = await run(() => filesService.restoreFile(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'file',
        entityId: input.id,
        diff: { restored: true, folderId: restored.folderId },
      });
      return restored;
    }),

  createFolder: authorizedProcedure('file.write')
    .input(createFolderSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() =>
        filesService.createFolder(ctx.db, ctx.session.userId, input.parentId, input.name),
      );
      ctx.audit.set({
        entityType: 'folder',
        entityId: created.id,
        diff: { parentId: input.parentId },
      });
      return created;
    }),

  renameFolder: authorizedProcedure('file.write')
    .input(renameFolderSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => filesService.renameFolder(ctx.db, input.id, input.name));
      ctx.audit.set({ entityType: 'folder', entityId: input.id, diff: { fields: ['name'] } });
      return { ok: true as const };
    }),

  moveFolder: authorizedProcedure('file.write')
    .input(moveFolderSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => filesService.moveFolder(ctx.db, input.id, input.parentId));
      ctx.audit.set({
        entityType: 'folder',
        entityId: input.id,
        diff: { fields: ['parentId'], parentId: input.parentId },
      });
      return { ok: true as const };
    }),

  deleteFolder: authorizedProcedure('file.delete')
    .input(folderIdSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() => filesService.deleteFolder(ctx.db, input.id));
      ctx.audit.set({ entityType: 'folder', entityId: input.id, diff: { deleted: true } });
      return result;
    }),
});
