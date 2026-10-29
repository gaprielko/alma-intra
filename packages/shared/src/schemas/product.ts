import { z } from 'zod';
import { idSchema } from './common.js';

/** How often a product's base price is paid (docs/products.md 3). */
export const PRODUCT_PERIODS = ['month', 'year'] as const;
export type ProductPeriod = (typeof PRODUCT_PERIODS)[number];

/** An item of a price list: paid every period of the product, or once. */
export const ITEM_BILLINGS = ['recurring', 'once'] as const;
export type ItemBilling = (typeof ITEM_BILLINGS)[number];

/** EUR to the cent. */
export const toCents = (n: number) => Math.round(n * 100) / 100;

/** A price, to the cent; NULL when not set. */
const money = z
  .number()
  .min(0)
  .max(1_000_000)
  .transform((n) => toCents(n));

/** One item of a product's price list (docs/products.md 3). */
export const priceItemSchema = z.object({
  itemId: idSchema,
  /** How many are in the base price. */
  included: z.number().int().min(0).max(100_000),
  /** Each further one, without and with VAT; NULL: none may be added beyond `included`. */
  unitPrice: money.nullable(),
  unitPriceGross: money.nullable(),
  /** The most a customer may have; NULL: no limit. */
  max: z.number().int().min(0).max(100_000).nullable(),
  billing: z.enum(ITEM_BILLINGS),
  /** Counted from the customer's workloads (R-14); recurring items only. */
  byWorkload: z.boolean().default(false),
});
export type PriceItemInput = z.infer<typeof priceItemSchema>;

export const productSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional(),
  basePrice: money.nullable(),
  basePriceGross: money.nullable(),
  period: z.enum(PRODUCT_PERIODS),
  /** „Ponúka sa“; off: „Už sa neponúka“, kept for the customers who have it. */
  active: z.boolean(),
  /** Every workload is rounded up to this many percent (R-14). */
  workloadStep: z.number().int().min(1).max(100),
  items: z.array(priceItemSchema).max(50),
});
export type ProductInput = z.infer<typeof productSchema>;

export const productIdSchema = z.object({ id: idSchema });
export const updateProductSchema = z.object({ id: idSchema, product: productSchema });

/** An item of the shared catalog (R-2). */
export const productItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(40).optional(),
  description: z.string().trim().max(400).optional(),
});
export type ProductItemInput = z.infer<typeof productItemSchema>;
export const updateProductItemSchema = z.object({ id: idSchema, item: productItemSchema });

/** Nastavenia › Ceny a DPH. */
export const vatRateSchema = z.object({ vatRate: z.number().min(0).max(100) });

/** A price with VAT from one without, to the cent (R-9). */
export const withVat = (net: number, ratePercent: number) => toCents(net * (1 + ratePercent / 100));
/** A price without VAT from one with, to the cent (R-9). */
export const withoutVat = (gross: number, ratePercent: number) =>
  toCents(gross / (1 + ratePercent / 100));

/** What a price is computed from: the product's base and its price list. */
export interface PriceList {
  basePrice: number | null;
  items: {
    itemId: string;
    included: number;
    unitPrice: number | null;
    billing: ItemBilling;
  }[];
}

/**
 * The price of a product for given counts (R-4): the base plus each recurring item above what the
 * base includes; one-off items apart. Without VAT; the caller adds it to the sums.
 */
export function priceOf(list: PriceList, counts: Record<string, number>) {
  let recurring = list.basePrice ?? 0;
  let once = 0;
  for (const item of list.items) {
    const count = counts[item.itemId] ?? item.included;
    const price = item.unitPrice ?? 0;
    if (item.billing === 'once') once += count * price;
    else recurring += Math.max(0, count - item.included) * price;
  }
  return { recurring: toCents(recurring), once: toCents(once) };
}

/**
 * The count of an item counted from workloads (R-14, R-15): each workload rounds up to the step,
 * at most 100 %; the sum, rounded up to whole ones.
 */
export function countFromWorkloads(
  workloads: readonly { persons: number; percent: number }[],
  stepPercent: number,
) {
  const rounded = (p: number) => Math.min(100, Math.ceil(p / stepPercent) * stepPercent);
  const sum = workloads.reduce((total, w) => total + w.persons * rounded(w.percent), 0);
  return { percent: sum, count: Math.ceil(sum / 100) };
}
