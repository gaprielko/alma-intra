import {
  HOLDERS_PAGE_SIZE,
  type ProductHoldersInput,
  productHoldersSchema,
  type ProductInput,
  type ProductItemInput,
  withoutVat,
  withVat,
} from '@intra/shared/schemas';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import {
  leadActivities,
  organizationProducts,
  organizations,
  pricingSettings,
  productItems,
  productPriceItems,
  products,
} from '../db/schema/index.js';

/** A refusal the web words for itself (`sk.products.errors`). */
export class ProductError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NAME_TAKEN' | 'IN_USE' | 'ITEM_TWICE') {
    super(code);
  }
}

const collated = (column: unknown) => sql`${column} collate "sk-x-icu"`;

const isNameClash = (error: unknown) => {
  const constraint =
    (error as { constraint?: string } | null)?.constraint ??
    (error as { cause?: { constraint?: string } } | null)?.cause?.constraint;
  return constraint === 'products_name_unique' || constraint === 'product_items_name_unique';
};

async function mapNameClash<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isNameClash(error)) throw new ProductError('NAME_TAKEN');
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// The VAT rate (R-9)

export async function getVatRate(db: Db | Tx): Promise<number> {
  const [row] = await db.select({ vatRate: pricingSettings.vatRate }).from(pricingSettings);
  return row?.vatRate ?? 23;
}

/**
 * A new VAT rate: the prices without VAT stay, those with VAT are computed again (R-9). How many
 * products the change touched.
 */
export async function setVatRate(db: Db, vatRate: number) {
  return db.transaction(async (tx) => {
    await tx
      .insert(pricingSettings)
      .values({ id: 1, vatRate })
      .onConflictDoUpdate({ target: pricingSettings.id, set: { vatRate, updatedAt: new Date() } });
    const factor = sql`(1 + ${vatRate}::numeric / 100)`;
    await tx
      .update(products)
      .set({ basePriceGross: sql`round(${products.basePrice} * ${factor}, 2)` })
      .where(sql`${products.basePrice} is not null`);
    await tx
      .update(productPriceItems)
      .set({ unitPriceGross: sql`round(${productPriceItems.unitPrice} * ${factor}, 2)` })
      .where(sql`${productPriceItems.unitPrice} is not null`);
    return { vatRate };
  });
}

/** Both prices of a pair, the missing one computed with the rate; what was typed stays. */
function bothPrices(net: number | null, gross: number | null, rate: number) {
  if (net !== null && gross !== null) return { net, gross };
  if (net !== null) return { net, gross: withVat(net, rate) };
  if (gross !== null) return { net: withoutVat(gross, rate), gross };
  return { net: null, gross: null };
}

// ---------------------------------------------------------------------------------------------
// Products

/** How many live organizations and prevádzky hold the product. */
const customersOf = sql<number>`(select count(*) from organization_products op
  join organizations o on o.id = op.organization_id
  where op.product_id = "products"."id" and o.deleted_at is null)`.mapWith(Number);

/** The price list of products, in its order, with the items' names. */
async function priceListsOf(db: Db | Tx, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, PriceListRow[]>();
  const rows = await db
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
    })
    .from(productPriceItems)
    .innerJoin(productItems, eq(productItems.id, productPriceItems.itemId))
    .where(inArray(productPriceItems.productId, productIds))
    .orderBy(asc(productPriceItems.position));
  const byProduct = new Map<string, PriceListRow[]>();
  for (const { productId, ...row } of rows) {
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), row]);
  }
  return byProduct;
}
type PriceListRow = {
  itemId: string;
  name: string;
  unit: string | null;
  included: number;
  unitPrice: number | null;
  unitPriceGross: number | null;
  max: number | null;
  billing: 'recurring' | 'once';
  byWorkload: boolean;
};

/** Produkty: every product with its price list and how many customers hold it. */
export async function listProducts(db: Db | Tx) {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      basePrice: products.basePrice,
      basePriceGross: products.basePriceGross,
      period: products.period,
      active: products.active,
      workloadStep: products.workloadStep,
      customers: customersOf,
    })
    .from(products)
    .orderBy(asc(products.position), collated(products.name));
  const lists = await priceListsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({ ...row, items: lists.get(row.id) ?? [] }));
}

/** A product with its price list and the organizations and prevádzky that hold it. */
export async function getProduct(db: Db | Tx, id: string) {
  const [row] = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      basePrice: products.basePrice,
      basePriceGross: products.basePriceGross,
      period: products.period,
      active: products.active,
      workloadStep: products.workloadStep,
      updatedAt: products.updatedAt,
      customers: customersOf,
    })
    .from(products)
    .where(eq(products.id, id));
  if (!row) throw new ProductError('NOT_FOUND');
  const lists = await priceListsOf(db, [id]);
  return { ...row, items: lists.get(id) ?? [] };
}

/** One page of who holds a product, by name; found by theirs or their organization's name. */
export async function listHolders(db: Db | Tx, raw: ProductHoldersInput) {
  const input = productHoldersSchema.parse(raw);
  const parent = sql<
    string | null
  >`(select p.name from organizations p where p.id = ${organizations.parentId})`;
  const conditions = [
    eq(organizationProducts.productId, input.id),
    isNull(organizations.deletedAt),
  ];
  if (input.search) {
    const pattern = `%${input.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      sql`unaccent(concat_ws(' ', ${organizations.name}, ${parent})) ilike unaccent(${pattern})`,
    );
  }
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      parentId: organizations.parentId,
      parentName: parent,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(organizationProducts)
    .innerJoin(organizations, eq(organizations.id, organizationProducts.organizationId))
    .where(and(...conditions))
    .orderBy(collated(organizations.name))
    .limit(HOLDERS_PAGE_SIZE)
    .offset((input.page - 1) * HOLDERS_PAGE_SIZE);
  return { items: rows, total: rows[0]?.total ?? 0 };
}

/** The product's own columns, both prices of the base filled. */
function productColumns(input: ProductInput, rate: number) {
  const base = bothPrices(input.basePrice, input.basePriceGross, rate);
  return {
    name: input.name,
    description: input.description || null,
    basePrice: base.net,
    basePriceGross: base.gross,
    period: input.period,
    active: input.active,
    workloadStep: input.workloadStep,
  };
}

/** The price list as given, replacing the old one; which items came, went or changed. */
async function setPriceList(tx: Tx, productId: string, input: ProductInput, rate: number) {
  const ids = input.items.map((i) => i.itemId);
  if (new Set(ids).size !== ids.length) throw new ProductError('ITEM_TWICE');
  const before = await tx
    .select()
    .from(productPriceItems)
    .where(eq(productPriceItems.productId, productId));
  await tx.delete(productPriceItems).where(eq(productPriceItems.productId, productId));
  const rows = input.items.map((item, position) => {
    const unit = bothPrices(item.unitPrice, item.unitPriceGross, rate);
    return {
      productId,
      itemId: item.itemId,
      included: item.included,
      unitPrice: unit.net,
      unitPriceGross: unit.gross,
      max: item.max,
      billing: item.billing,
      byWorkload: item.billing === 'recurring' && item.byWorkload,
      position,
    };
  });
  if (rows.length > 0) await tx.insert(productPriceItems).values(rows);
  const old = new Map(before.map((b) => [b.itemId, b]));
  const changed = rows
    .filter((r) => {
      const b = old.get(r.itemId);
      return (
        b &&
        (b.included !== r.included ||
          b.unitPrice !== r.unitPrice ||
          b.max !== r.max ||
          b.billing !== r.billing ||
          b.byWorkload !== r.byWorkload)
      );
    })
    .map((r) => r.itemId);
  return {
    itemsAdded: ids.filter((id) => !old.has(id)),
    itemsRemoved: before.map((b) => b.itemId).filter((id) => !ids.includes(id)),
    itemsChanged: changed,
  };
}

export async function createProduct(db: Db, input: ProductInput) {
  return mapNameClash(() =>
    db.transaction(async (tx) => {
      const rate = await getVatRate(tx);
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${products.position}), 0) + 1` })
        .from(products)) as [{ next: number }];
      const [created] = await tx
        .insert(products)
        .values({ ...productColumns(input, rate), position: Number(next) })
        .returning({ id: products.id });
      const change = await setPriceList(tx, created!.id, input, rate);
      return { id: created!.id, ...change };
    }),
  );
}

export async function updateProduct(db: Db, id: string, input: ProductInput) {
  return mapNameClash(() =>
    db.transaction(async (tx) => {
      const [current] = await tx.select().from(products).where(eq(products.id, id)).for('update');
      if (!current) throw new ProductError('NOT_FOUND');
      const rate = await getVatRate(tx);
      const values = productColumns(input, rate);
      const fields = (Object.keys(values) as (keyof typeof values)[]).filter(
        (key) => (current[key] ?? null) !== (values[key] ?? null),
      );
      await tx
        .update(products)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(products.id, id));
      const change = await setPriceList(tx, id, input, rate);
      return { fields, ...change };
    }),
  );
}

/** „Duplikovať“: the product and its price list under „X (kópia)“, not offered yet. */
export async function duplicateProduct(db: Db, id: string) {
  const source = await getProduct(db, id);
  const names = new Set(
    (await db.select({ name: products.name }).from(products)).map((r) =>
      r.name.toLocaleLowerCase('sk'),
    ),
  );
  let name = `${source.name} (kópia)`;
  for (let n = 2; names.has(name.toLocaleLowerCase('sk')); n += 1)
    name = `${source.name} (kópia ${n})`;
  return createProduct(db, {
    name,
    ...(source.description ? { description: source.description } : {}),
    basePrice: source.basePrice,
    basePriceGross: source.basePriceGross,
    period: source.period,
    active: source.active,
    workloadStep: source.workloadStep,
    items: source.items.map((item) => ({
      itemId: item.itemId,
      included: item.included,
      unitPrice: item.unitPrice,
      unitPriceGross: item.unitPriceGross,
      max: item.max,
      billing: item.billing,
      byWorkload: item.byWorkload,
    })),
  });
}

/** Only a product nobody holds can go; otherwise it is „Už sa neponúka“. */
export async function deleteProduct(db: Db, id: string) {
  return db.transaction(async (tx) => {
    // As the list counts its customers: an organization in the trash holds nothing any more.
    const [held] = await tx
      .select({ id: organizationProducts.organizationId })
      .from(organizationProducts)
      .innerJoin(organizations, eq(organizations.id, organizationProducts.organizationId))
      .where(and(eq(organizationProducts.productId, id), isNull(organizations.deletedAt)))
      .limit(1);
    if (held) throw new ProductError('IN_USE');
    // Somebody's interest in it keeps the product; one already removed from Aktivity does not.
    const [wanted] = await tx
      .select({ id: leadActivities.id })
      .from(leadActivities)
      .where(and(eq(leadActivities.productId, id), isNull(leadActivities.deletedAt)))
      .limit(1);
    if (wanted) throw new ProductError('IN_USE');
    await tx.delete(leadActivities).where(eq(leadActivities.productId, id));
    await tx.delete(organizationProducts).where(eq(organizationProducts.productId, id));
    const [row] = await tx
      .delete(products)
      .where(eq(products.id, id))
      .returning({ id: products.id });
    if (!row) throw new ProductError('NOT_FOUND');
  });
}

// ---------------------------------------------------------------------------------------------
// The shared items (R-2)

/** Položky: every item with the products whose price list has it, and its numbers there. */
export async function listItems(db: Db | Tx) {
  const usedIn = sql<
    {
      productId: string;
      product: string;
      included: number;
      unitPriceGross: number | null;
      max: number | null;
      billing: 'recurring' | 'once';
    }[]
  >`coalesce((select json_agg(json_build_object('productId', p.id, 'product', p.name,
      'included', pi.included, 'unitPriceGross', pi.unit_price_gross, 'max', pi.max,
      'billing', pi.billing) order by p.position, p.name collate "sk-x-icu")
    from product_price_items pi join products p on p.id = pi.product_id
    where pi.item_id = "product_items"."id"), '[]'::json)`;
  return db
    .select({
      id: productItems.id,
      name: productItems.name,
      unit: productItems.unit,
      description: productItems.description,
      usedIn,
    })
    .from(productItems)
    .orderBy(collated(productItems.name));
}

const itemColumns = (input: ProductItemInput) => ({
  name: input.name,
  unit: input.unit || null,
  description: input.description || null,
});

export async function createItem(db: Db, input: ProductItemInput) {
  return mapNameClash(async () => {
    const [created] = await db
      .insert(productItems)
      .values(itemColumns(input))
      .returning({ id: productItems.id });
    return { id: created!.id };
  });
}

/** A renamed item shows under its new name in every product (R-2). */
export async function updateItem(db: Db, id: string, input: ProductItemInput) {
  return mapNameClash(async () => {
    const [current] = await db.select().from(productItems).where(eq(productItems.id, id));
    if (!current) throw new ProductError('NOT_FOUND');
    const values = itemColumns(input);
    const fields = (Object.keys(values) as (keyof typeof values)[]).filter(
      (key) => (current[key] ?? null) !== (values[key] ?? null),
    );
    await db.update(productItems).set(values).where(eq(productItems.id, id));
    return { fields };
  });
}

/** Only an item no price list uses can go. */
export async function deleteItem(db: Db, id: string) {
  const [used] = await db
    .select({ id: productPriceItems.productId })
    .from(productPriceItems)
    .where(eq(productPriceItems.itemId, id))
    .limit(1);
  if (used) throw new ProductError('IN_USE');
  const [row] = await db
    .delete(productItems)
    .where(eq(productItems.id, id))
    .returning({ id: productItems.id });
  if (!row) throw new ProductError('NOT_FOUND');
}
