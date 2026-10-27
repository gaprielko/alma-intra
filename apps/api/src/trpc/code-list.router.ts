import {
  codeItemIdSchema,
  codeListSchema,
  createCodeItemSchema,
  renameTagSchema,
  reorderCodeItemsSchema,
  tagIdSchema,
  updateCodeItemSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as codeLists from '../customers/code-lists.service.js';
import { authorizedProcedure, router } from './trpc.js';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof codeLists.CodeListError)) throw error;
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'NAME_TAKEN'
          ? 'CONFLICT'
          : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

/**
 * Settings › Číselníky: customer types and sources (named, ordered, switched off rather than
 * deleted while used) and the tags. Adding a type is also offered right in the customer form.
 */
export const codeListRouter = router({
  list: authorizedProcedure('customer.read')
    .input(codeListSchema)
    .query(({ ctx, input }) => codeLists.listItems(ctx.db, input.list)),

  /** From the settings, and „Nový typ organizácie“ in the customer form. */
  create: authorizedProcedure('customer.write')
    .input(createCodeItemSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() => codeLists.createItem(ctx.db, input.list, input.name));
      ctx.audit.set({ entityType: 'code_list', entityId: created.id, diff: { list: input.list } });
      return created;
    }),

  update: authorizedProcedure('code_list.manage')
    .input(updateCodeItemSchema)
    .mutation(async ({ ctx, input }) => {
      const { fields } = await run(() =>
        codeLists.updateItem(ctx.db, input.list, input.id, {
          name: input.name,
          active: input.active,
        }),
      );
      ctx.audit.set({
        entityType: 'code_list',
        entityId: input.id,
        diff: { list: input.list, fields, active: input.active },
      });
      return { ok: true as const };
    }),

  delete: authorizedProcedure('code_list.manage')
    .input(codeItemIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => codeLists.deleteItem(ctx.db, input.list, input.id));
      ctx.audit.set({ entityType: 'code_list', entityId: input.id, diff: { list: input.list } });
      return { ok: true as const };
    }),

  reorder: authorizedProcedure('code_list.manage')
    .input(reorderCodeItemsSchema)
    .mutation(async ({ ctx, input }) => {
      await codeLists.reorderItems(ctx.db, input.list, input.ids);
      ctx.audit.set({ entityType: 'code_list', diff: { list: input.list } });
      return { ok: true as const };
    }),

  tags: authorizedProcedure('customer.read').query(({ ctx }) => codeLists.listTags(ctx.db)),

  tagRename: authorizedProcedure('code_list.manage')
    .input(renameTagSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => codeLists.renameTag(ctx.db, input.id, input.name));
      ctx.audit.set({ entityType: 'code_list', entityId: input.id, diff: { list: 'tag' } });
      return { ok: true as const };
    }),

  tagDelete: authorizedProcedure('code_list.manage')
    .input(tagIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => codeLists.deleteTag(ctx.db, input.id));
      ctx.audit.set({ entityType: 'code_list', entityId: input.id, diff: { list: 'tag' } });
      return { ok: true as const };
    }),
});
