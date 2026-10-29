import { type HoldingInput, heldPrice, withVat } from '@intra/shared/schemas';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import {
  organizationProductCounts,
  organizationProducts,
  organizationProductWorkloads,
  organizations,
  productItems,
  productPriceItems,
  products,
} from '../db/schema/index.js';
import { getVatRate } from '../products/products.service.js';

/** A refusal the web words for itself (`sk.holdings.errors`). */
export class HoldingError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'PRODUCT_NOT_FOUND' | 'COUNT_OUT_OF_RANGE') {
    super(code);
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The products an organization and its prevádzky hold (or only a prevádzka's own), each with its
 * counts, workloads and price now, monthly and yearly, without and with VAT (docs/products.md 9.1).
 */
export async function holdingsOf(db: Db | Tx, organizationId: string) {
  const holders = await db
    .select({ id: organizations.id, name: organizations.name, parentId: organizations.parentId })
    .from(organizations)
    .where(
      and(
        or(eq(organizations.id, organizationId), eq(organizations.parentId, organizationId)),
        isNull(organizations.deletedAt),
      ),
    );
  const ids = holders.map((h) => h.id);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ holding: organizationProducts, product: products })
    .from(organizationProducts)
    .innerJoin(products, eq(products.id, organizationProducts.productId))
    .where(inArray(organizationProducts.organizationId, ids));
  if (rows.length === 0) return [];
  const productIds = [...new Set(rows.map((r) => r.product.id))];
  const [items, counts, workloads, rate] = await Promise.all([
    db
      .select({
        productId: productPriceItems.productId,
        itemId: productPriceItems.itemId,
        name: productItems.name,
        unit: productItems.unit,
        included: productPriceItems.included,
        unitPrice: productPriceItems.unitPrice,
        unitPriceGross: productPriceItems.unitPriceGross,
        max: productPriceItems.max,
        billing: productPriceItems.billing,
        byWorkload: productPriceItems.byWorkload,
        position: productPriceItems.position,
      })
      .from(productPriceItems)
      .innerJoin(productItems, eq(productItems.id, productPriceItems.itemId))
      .where(inArray(productPriceItems.productId, productIds))
      .orderBy(productPriceItems.position),
    db
      .select()
      .from(organizationProductCounts)
      .where(inArray(organizationProductCounts.organizationId, ids)),
    db
      .select()
      .from(organizationProductWorkloads)
      .where(inArray(organizationProductWorkloads.organizationId, ids)),
    getVatRate(db),
  ]);
  const byHolder = new Map(holders.map((h) => [h.id, h]));
  const today = iso(new Date());
  return rows
    .map(({ holding, product }) => {
      const list = items.filter((i) => i.productId === product.id);
      const own = (r: { organizationId: string; productId: string }) =>
        r.organizationId === holding.organizationId && r.productId === product.id;
      const countMap = Object.fromEntries(
        counts.filter(own).map((c) => [c.itemId, c.count]),
      ) as Record<string, number>;
      const workloadMap: Record<string, { persons: number; percent: number }[]> = {};
      for (const w of workloads.filter(own))
        (workloadMap[w.itemId] ??= []).push({ persons: w.persons, percent: w.percent });
      const price = heldPrice({
        product: {
          basePrice: product.basePrice,
          period: product.period,
          workloadStep: product.workloadStep,
          items: list,
        },
        counts: countMap,
        workloads: workloadMap,
        pricing: holding.pricing,
        discountPercent: holding.discountPercent,
        discountMonths: holding.discountMonths,
        fixedPrice: holding.fixedPrice,
        validFrom: holding.validFrom,
      });
      const holder = byHolder.get(holding.organizationId)!;
      return {
        ...holding,
        holder: { id: holder.id, name: holder.name, isEstablishment: holder.parentId !== null },
        product: {
          id: product.id,
          name: product.name,
          period: product.period,
          workloadStep: product.workloadStep,
          basePrice: product.basePrice,
          basePriceGross: product.basePriceGross,
        },
        items: list.map(({ productId: _p, position: _q, ...item }) => ({
          ...item,
          count: price.counts[item.itemId] ?? 0,
          workloads: workloadMap[item.itemId] ?? [],
        })),
        active: holding.validTo === null || holding.validTo >= today,
        price: {
          ...price,
          monthlyGross: withVat(price.monthly, rate),
          yearlyGross: withVat(price.yearly, rate),
          onceGross: withVat(price.once, rate),
        },
      };
    })
    .sort(
      (a, b) =>
        Number(a.holder.isEstablishment) - Number(b.holder.isEstablishment) ||
        a.holder.name.localeCompare(b.holder.name, 'sk') ||
        a.product.name.localeCompare(b.product.name, 'sk'),
    );
}

/**
 * „Sestry“ in the header (R-12): the counts of the item „Sestra“ over the organization and its
 * prevádzky, of the products held now; NULL when none of them has the item.
 */
export async function nursesOf(db: Db | Tx, organizationId: string) {
  const held = await holdingsOf(db, organizationId);
  let total: number | null = null;
  for (const h of held.filter((x) => x.active))
    for (const item of h.items)
      if (item.name.toLocaleLowerCase('sk') === 'sestra') total = (total ?? 0) + item.count;
  return total;
}

/**
 * Saves a product at an organization or a prevádzka (new or changed): its dates, pricing, counts
 * and workloads; a count below the package or above the maximum is refused (R-13).
 */
export async function saveHolding(db: Db, input: HoldingInput) {
  return db.transaction(async (tx) => {
    const [holder] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, input.organizationId), isNull(organizations.deletedAt)));
    if (!holder) throw new HoldingError('NOT_FOUND');
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, input.productId));
    if (!product) throw new HoldingError('PRODUCT_NOT_FOUND');
    const list = await tx
      .select()
      .from(productPriceItems)
      .where(eq(productPriceItems.productId, input.productId));
    for (const c of input.counts) {
      const item = list.find((i) => i.itemId === c.itemId);
      if (!item) continue;
      const floor = item.billing === 'once' ? 0 : item.included;
      if (c.count < floor || (item.max !== null && c.count > item.max))
        throw new HoldingError('COUNT_OUT_OF_RANGE');
    }
    const rate = await getVatRate(tx);
    const fixedPrice =
      input.fixedPrice ??
      (input.fixedPriceGross === null
        ? null
        : Math.round((input.fixedPriceGross / (1 + rate / 100)) * 100) / 100);
    const fixedPriceGross =
      input.fixedPriceGross ?? (input.fixedPrice === null ? null : withVat(input.fixedPrice, rate));
    const values = {
      validFrom: input.validFrom,
      validTo: input.validTo,
      pricing: input.pricing,
      discountPercent: input.pricing === 'discount' ? input.discountPercent : null,
      discountMonths: input.pricing === 'discount' ? input.discountMonths : null,
      fixedPrice: input.pricing === 'fixed' ? fixedPrice : null,
      fixedPriceGross: input.pricing === 'fixed' ? fixedPriceGross : null,
      note: input.note || null,
      updatedAt: new Date(),
    };
    const [existing] = await tx
      .select({ id: organizationProducts.productId })
      .from(organizationProducts)
      .where(
        and(
          eq(organizationProducts.organizationId, input.organizationId),
          eq(organizationProducts.productId, input.productId),
        ),
      );
    if (existing) {
      await tx
        .update(organizationProducts)
        .set(values)
        .where(
          and(
            eq(organizationProducts.organizationId, input.organizationId),
            eq(organizationProducts.productId, input.productId),
          ),
        );
    } else {
      await tx
        .insert(organizationProducts)
        .values({ organizationId: input.organizationId, productId: input.productId, ...values });
    }
    const key = and(
      eq(organizationProductCounts.organizationId, input.organizationId),
      eq(organizationProductCounts.productId, input.productId),
    );
    await tx.delete(organizationProductCounts).where(key);
    const known = new Set(list.map((i) => i.itemId));
    const counts = input.counts.filter((c) => known.has(c.itemId));
    if (counts.length > 0)
      await tx.insert(organizationProductCounts).values(
        counts.map((c) => ({
          organizationId: input.organizationId,
          productId: input.productId,
          itemId: c.itemId,
          count: c.count,
        })),
      );
    await tx
      .delete(organizationProductWorkloads)
      .where(
        and(
          eq(organizationProductWorkloads.organizationId, input.organizationId),
          eq(organizationProductWorkloads.productId, input.productId),
        ),
      );
    const workloads = input.workloads.filter((w) => known.has(w.itemId));
    if (workloads.length > 0)
      await tx.insert(organizationProductWorkloads).values(
        workloads.map((w) => ({
          organizationId: input.organizationId,
          productId: input.productId,
          itemId: w.itemId,
          persons: w.persons,
          percent: w.percent,
        })),
      );
    await tx
      .update(organizations)
      .set({ updatedAt: new Date() })
      .where(eq(organizations.id, input.organizationId));
    return { created: !existing };
  });
}

/** „Ukončiť“: the product ends today; it stays in the history (R-10). */
export async function endHolding(db: Db, organizationId: string, productId: string) {
  const [row] = await db
    .update(organizationProducts)
    .set({ validTo: sql`current_date`, updatedAt: new Date() })
    .where(
      and(
        eq(organizationProducts.organizationId, organizationId),
        eq(organizationProducts.productId, productId),
      ),
    )
    .returning({ id: organizationProducts.productId });
  if (!row) throw new HoldingError('NOT_FOUND');
}
