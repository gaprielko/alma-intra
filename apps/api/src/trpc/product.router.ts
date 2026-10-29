import {
  productIdSchema,
  productItemSchema,
  productSchema,
  updateProductItemSchema,
  updateProductSchema,
  vatRateSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { holdingsOf } from '../customers/holdings.service.js';
import * as productsService from '../products/products.service.js';
import { authorizedProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof productsService.ProductError)) throw error;
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'NAME_TAKEN' || error.code === 'IN_USE'
          ? 'CONFLICT'
          : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

/** Produkty (docs/products.md): products with their price lists, the shared items, the VAT rate. */
export const productRouter = router({
  list: authorizedProcedure('product.read').query(({ ctx }) =>
    productsService.listProducts(ctx.db),
  ),

  get: authorizedProcedure('product.read')
    .input(productIdSchema)
    .query(async ({ ctx, input }) => {
      const product = await run(() => productsService.getProduct(ctx.db, input.id));
      // Each holder's counts and price, as its detail shows them (the first 30).
      const holders = await Promise.all(
        product.holders.slice(0, 30).map(async (holder) => {
          const held = (await holdingsOf(ctx.db, holder.id)).find(
            (h) => h.organizationId === holder.id && h.productId === input.id,
          );
          return {
            ...holder,
            scope: held
              ? held.items
                  .filter((i) => i.billing === 'recurring' && i.count > 0)
                  .map((i) => `${i.count} × ${i.name}`)
                  .join(' · ')
              : '',
            monthly: held?.price.monthly ?? null,
            yearly: held?.price.yearly ?? null,
            monthlyGross: held?.price.monthlyGross ?? null,
            yearlyGross: held?.price.yearlyGross ?? null,
          };
        }),
      );
      return { ...product, holders };
    }),

  create: authorizedProcedure('product.write')
    .input(productSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() => productsService.createProduct(ctx.db, input));
      ctx.audit.set({
        entityType: 'product',
        entityId: created.id,
        diff: { created: true, itemsAdded: created.itemsAdded },
      });
      return { id: created.id };
    }),

  update: authorizedProcedure('product.write')
    .input(updateProductSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() =>
        productsService.updateProduct(ctx.db, input.id, input.product),
      );
      ctx.audit.set({
        entityType: 'product',
        entityId: input.id,
        diff: {
          fields: change.fields,
          ...(change.itemsAdded.length > 0 ? { itemsAdded: change.itemsAdded } : {}),
          ...(change.itemsRemoved.length > 0 ? { itemsRemoved: change.itemsRemoved } : {}),
          ...(change.itemsChanged.length > 0 ? { itemsChanged: change.itemsChanged } : {}),
        },
      });
      return { ok: true as const };
    }),

  duplicate: authorizedProcedure('product.write')
    .input(productIdSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() => productsService.duplicateProduct(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'product',
        entityId: created.id,
        diff: { created: true, duplicatedFrom: input.id },
      });
      return { id: created.id };
    }),

  delete: authorizedProcedure('product.write')
    .input(productIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => productsService.deleteProduct(ctx.db, input.id));
      ctx.audit.set({ entityType: 'product', entityId: input.id, diff: { deleted: true } });
      return { ok: true as const };
    }),

  items: authorizedProcedure('product.read').query(({ ctx }) => productsService.listItems(ctx.db)),

  itemCreate: authorizedProcedure('product.write')
    .input(productItemSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() => productsService.createItem(ctx.db, input));
      ctx.audit.set({ entityType: 'product_item', entityId: created.id, diff: { created: true } });
      return created;
    }),

  itemUpdate: authorizedProcedure('product.write')
    .input(updateProductItemSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() => productsService.updateItem(ctx.db, input.id, input.item));
      ctx.audit.set({ entityType: 'product_item', entityId: input.id, diff: change });
      return { ok: true as const };
    }),

  itemDelete: authorizedProcedure('product.write')
    .input(productIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => productsService.deleteItem(ctx.db, input.id));
      ctx.audit.set({ entityType: 'product_item', entityId: input.id, diff: { deleted: true } });
      return { ok: true as const };
    }),

  vatRate: authorizedProcedure('product.read').query(async ({ ctx }) => ({
    vatRate: await productsService.getVatRate(ctx.db),
  })),

  setVatRate: authorizedProcedure('pricing.manage')
    .input(vatRateSchema)
    .mutation(async ({ ctx, input }) => {
      await productsService.setVatRate(ctx.db, input.vatRate);
      ctx.audit.set({ entityType: 'pricing', diff: { vatRate: input.vatRate } });
      return { ok: true as const };
    }),
});
