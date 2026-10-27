import type { CodeList } from '@intra/shared/schemas';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import {
  customers,
  customerSources,
  customerTags,
  customerTypes,
  emailTemplates,
  tags,
  templateCategories,
} from '../db/schema/index.js';

/** A refusal the web words for itself (`sk.codeLists.errors`). */
export class CodeListError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NAME_TAKEN' | 'IN_USE') {
    super(code);
  }
}

const TABLES = {
  customer_type: customerTypes,
  source: customerSources,
  template_category: templateCategories,
} as const;
/** What uses an item: customers for their type and source, templates for their category. */
const USED_BY = {
  customer_type: customers.typeId,
  source: customers.sourceId,
  template_category: emailTemplates.categoryId,
} as const;
// Raw names for the correlated count: Drizzle writes columns bare in a single-table query.
const TABLE_NAMES = {
  customer_type: 'customer_types',
  source: 'customer_sources',
  template_category: 'template_categories',
} as const;
const USED_BY_TABLE = {
  customer_type: 'customers',
  source: 'customers',
  template_category: 'email_templates',
} as const;
const USED_BY_COLUMN = {
  customer_type: 'type_id',
  source: 'source_id',
  template_category: 'category_id',
} as const;

const isNameClash = (error: unknown) => {
  const constraint =
    (error as { constraint?: string } | null)?.constraint ??
    (error as { cause?: { constraint?: string } } | null)?.cause?.constraint;
  return typeof constraint === 'string' && constraint.endsWith('_name_unique');
};

async function mapNameClash<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isNameClash(error)) throw new CodeListError('NAME_TAKEN');
    throw error;
  }
}

/**
 * How many live rows use an item: customers for a type or a source, templates (deactivated ones
 * included) for a category.
 */
const usageCount = (list: CodeList) =>
  list === 'template_category'
    ? sql<number>`(select count(*) from email_templates c
        where c.category_id = "template_categories"."id")`.mapWith(Number)
    : sql<number>`(select count(*) from ${sql.raw(USED_BY_TABLE[list])} c
        where c.${sql.raw(USED_BY_COLUMN[list])} = ${sql.raw(`"${TABLE_NAMES[list]}"."id"`)}
          and c.deleted_at is null)`.mapWith(Number);

/** The items of a list in their order, with how many live rows use each. */
export async function listItems(db: Db | Tx, list: CodeList) {
  const table = TABLES[list];
  const items = await db
    .select({
      id: table.id,
      name: table.name,
      active: table.active,
      position: table.position,
      customers: usageCount(list),
    })
    .from(table)
    .orderBy(asc(table.position), sql`${table.name} collate "sk-x-icu"`);
  const [without] =
    list === 'template_category'
      ? await db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(emailTemplates)
          .where(isNull(emailTemplates.categoryId))
      : await db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(customers)
          .where(and(isNull(USED_BY[list]), isNull(customers.deletedAt)));
  return { items, withoutCount: without?.count ?? 0 };
}

/** A new item, last in the order. */
export async function createItem(db: Db | Tx, list: CodeList, name: string) {
  const table = TABLES[list];
  return mapNameClash(async () => {
    const [created] = await db
      .insert(table)
      .values({
        name,
        position: sql`(select coalesce(max(${table.position}), 0) + 1 from ${table})`,
      })
      .returning({ id: table.id, name: table.name });
    return created!;
  });
}

export async function updateItem(
  db: Db | Tx,
  list: CodeList,
  id: string,
  values: { name: string; active: boolean },
) {
  const table = TABLES[list];
  return mapNameClash(async () => {
    const [before] = await db.select().from(table).where(eq(table.id, id));
    if (!before) throw new CodeListError('NOT_FOUND');
    await db.update(table).set(values).where(eq(table.id, id));
    const fields = [
      ...(before.name !== values.name ? ['name'] : []),
      ...(before.active !== values.active ? ['active'] : []),
    ];
    return { fields };
  });
}

/** Only an item nothing uses goes; one in use can only be switched off. */
export async function deleteItem(db: Db, list: CodeList, id: string) {
  const table = TABLES[list];
  await db.transaction(async (tx) => {
    const [used] =
      list === 'template_category'
        ? await tx
            .select({ id: emailTemplates.id })
            .from(emailTemplates)
            .where(eq(emailTemplates.categoryId, id))
            .limit(1)
        : await tx
            .select({ id: customers.id })
            .from(customers)
            .where(eq(USED_BY[list], id))
            .limit(1);
    if (used) throw new CodeListError('IN_USE');
    const rows = await tx.delete(table).where(eq(table.id, id)).returning({ id: table.id });
    if (rows.length === 0) throw new CodeListError('NOT_FOUND');
  });
}

/** The order the list is shown and offered in, as the ids come. */
export async function reorderItems(db: Db, list: CodeList, ids: string[]) {
  const table = TABLES[list];
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(table)
        .set({ position: index + 1 })
        .where(eq(table.id, id));
    }
  });
}

/** Every tag with how many live customers carry it. */
export async function listTags(db: Db | Tx) {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      customers: sql<number>`(select count(*) from customer_tags ct
        join customers c on c.id = ct.customer_id
        where ct.tag_id = "tags"."id" and c.deleted_at is null)`.mapWith(Number),
    })
    .from(tags)
    .orderBy(sql`${tags.name} collate "sk-x-icu"`);
}

export async function renameTag(db: Db | Tx, id: string, name: string) {
  return mapNameClash(async () => {
    const [clash] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(sql`lower(${tags.name})`, name.toLocaleLowerCase('sk')), ne(tags.id, id)));
    if (clash) throw new CodeListError('NAME_TAKEN');
    const rows = await db
      .update(tags)
      .set({ name })
      .where(eq(tags.id, id))
      .returning({ id: tags.id });
    if (rows.length === 0) throw new CodeListError('NOT_FOUND');
  });
}

/** A tag goes only when no customer in the list carries it; a deleted one loses it with it. */
export async function deleteTag(db: Db, id: string) {
  await db.transaction(async (tx) => {
    const [used] = await tx
      .select({ id: customerTags.customerId })
      .from(customerTags)
      .innerJoin(customers, eq(customers.id, customerTags.customerId))
      .where(and(eq(customerTags.tagId, id), isNull(customers.deletedAt)))
      .limit(1);
    if (used) throw new CodeListError('IN_USE');
    const rows = await tx.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
    if (rows.length === 0) throw new CodeListError('NOT_FOUND');
  });
}
