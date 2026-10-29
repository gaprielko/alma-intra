import { personName } from '@intra/shared/schemas';
import type {
  ContactInput,
  CreateCustomerInput,
  CustomerFilter,
  CustomerInput,
  CustomerListInput,
  CustomerStatus,
} from '@intra/shared/schemas';
import { customerListSchema } from '@intra/shared/schemas';
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import {
  auditEvents,
  contacts,
  contactTypes,
  customerSources,
  customers,
  customerTags,
  customerProducts,
  products,
  tags,
  users,
} from '../db/schema/index.js';
import { createCustomerFolder } from '../files/files.service.js';

/** The object without one key, for a row that must not leave the server whole. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/** A refusal the web words for itself (`sk.customers.errors`). */
export class CustomerError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'ICO_TAKEN'
      | 'KIND_CHANGED'
      | 'CONTACT_EMAIL_TAKEN'
      | 'NOT_ORGANIZATION'
      | 'CONTACT_TYPE_UNKNOWN',
  ) {
    super(code);
  }
}

const alive = isNull(customers.deletedAt);
const aliveContact = isNull(contacts.deletedAt);
/** Names sorted as a Slovak reader expects: case and accents in their places. */
const collated = (column: SQL | AnyColumn) => sql`${column} collate "sk-x-icu"`;

/**
 * The customer's id, always qualified: Drizzle writes columns bare in a single-table query, and a
 * bare `id` inside a correlated subquery would name the subquery's own table.
 */
const CUSTOMER_ID = sql.raw('"customers"."id"');

/** `%text%` for ILIKE, with the wildcards somebody typed taken literally. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The status filter: one status, or the records without one. */
const statusWhere = (status: CustomerFilter['status']) =>
  status === 'none' ? [isNull(customers.status)] : status ? [eq(customers.status, status)] : [];

/** The filters of the list as a WHERE clause; `status` is left to the caller (the chips count without it). */
function filterWhere(filter: CustomerFilter): SQL[] {
  const where: SQL[] = [alive];
  if (filter.kind) where.push(eq(customers.kind, filter.kind));
  if (filter.contactTypeId) where.push(eq(customers.contactTypeId, filter.contactTypeId));
  if (filter.productId === 'none') {
    where.push(
      sql`not exists (select 1 from customer_products cp where cp.customer_id = ${CUSTOMER_ID})`,
    );
  } else if (filter.productId) {
    where.push(
      sql`exists (select 1 from customer_products cp where cp.customer_id = ${CUSTOMER_ID} and cp.product_id = ${filter.productId})`,
    );
  }
  if (filter.region) where.push(eq(customers.region, filter.region));
  if (filter.ownerUserId) where.push(eq(customers.ownerUserId, filter.ownerUserId));
  if (filter.tagId) {
    where.push(
      sql`exists (select 1 from customer_tags ct where ct.customer_id = ${CUSTOMER_ID} and ct.tag_id = ${filter.tagId})`,
    );
  }
  if (filter.search) {
    const pattern = likePattern(filter.search);
    const digits = filter.search.replace(/\s/g, '');
    where.push(
      or(
        // Without regard to diacritics either: „Toth“ finds „Tóth“ (migration 0022).
        sql`unaccent(${customers.name}) ilike unaccent(${pattern})`,
        sql`${customers.email} ilike ${pattern}`,
        /^\d+$/.test(digits) ? sql`${customers.ico} like ${likePattern(digits)}` : sql`false`,
        sql`exists (select 1 from contacts p where p.customer_id = ${CUSTOMER_ID}
          and p.deleted_at is null
          and (p.email ilike ${pattern}
            or unaccent(p.first_name || ' ' || p.last_name) ilike unaccent(${pattern})))`,
      )!,
    );
  }
  return where;
}

/** The customer's tags, by name, as JSON. */
const tagsJson = sql<{ id: string; name: string }[]>`coalesce((
  select json_agg(json_build_object('id', t.id, 'name', t.name) order by t.name collate "sk-x-icu")
  from customer_tags ct join tags t on t.id = ct.tag_id
  where ct.customer_id = ${CUSTOMER_ID}), '[]'::json)`;

/** The record's products, in the order of the code list, as JSON. */
const productsJson = sql<{ id: string; name: string }[]>`coalesce((
  select json_agg(json_build_object('id', p.id, 'name', p.name)
    order by p.position, p.name collate "sk-x-icu")
  from customer_products cp join products p on p.id = cp.product_id
  where cp.customer_id = ${CUSTOMER_ID}), '[]'::json)`;

/** The primary contact, or for a private person the person. */
const primaryContactJson = sql<{
  name: string;
  email: string | null;
} | null>`case when ${customers.kind} = 'individual'
  then json_build_object('name', ${customers.name}, 'email', ${customers.email})
  else (select json_build_object(
      'name', concat_ws(' ', p.title_before, p.first_name, p.last_name), 'email', p.email)
    from contacts p
    where p.customer_id = ${CUSTOMER_ID} and p.is_primary and p.deleted_at is null)
  end`;

/** The last activity, e-mail sent to the customer or reply received from it. */
export const LAST_CONTACT = sql`greatest(
  (select max(a.occurred_at) from activities a
    where a.customer_id = ${CUSTOMER_ID} and a.deleted_at is null),
  (select max(m.sent_at) from campaign_messages m where m.customer_id = ${CUSTOMER_ID}),
  (select max(i.received_at) from inbound_messages i
    where i.customer_id = ${CUSTOMER_ID} and i.status = 'assigned'))`;

const SORTS = {
  name: collated(customers.name),
  status: sql`${customers.status}`,
  createdAt: sql`${customers.createdAt}`,
  updatedAt: sql`${customers.updatedAt}`,
  lastContact: LAST_CONTACT,
};

/**
 * One page of the customer list, the number of customers in each status for the chips (with
 * every other filter applied), and the total the pager counts.
 */
export async function listCustomers(db: Db | Tx, raw: CustomerListInput) {
  const input = customerListSchema.parse(raw);
  const base = filterWhere(input);
  const where = [...base, ...statusWhere(input.status)];
  // Customers never contacted, and records without a status, go last whichever way it is sorted.
  const order =
    input.sort === 'lastContact' || input.sort === 'status'
      ? sql`${SORTS[input.sort]} ${sql.raw(input.dir === 'desc' ? 'desc' : 'asc')} nulls last`
      : input.dir === 'desc'
        ? desc(SORTS[input.sort])
        : asc(SORTS[input.sort]);

  const [items, statusCounts] = await Promise.all([
    db
      .select({
        id: customers.id,
        kind: customers.kind,
        name: customers.name,
        city: customers.city,
        contactTypeName: contactTypes.name,
        products: productsJson,
        status: customers.status,
        owner: sql<{ id: string; name: string } | null>`case when ${users.id} is null then null
          else json_build_object('id', ${users.id}, 'name', ${users.name}) end`,
        tags: tagsJson,
        primaryContact: primaryContactJson,
        lastContactAt: sql<string | null>`${LAST_CONTACT}`,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(customers)
      .innerJoin(contactTypes, eq(contactTypes.id, customers.contactTypeId))
      .leftJoin(users, eq(users.id, customers.ownerUserId))
      .where(and(...where))
      .orderBy(order, asc(customers.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({ status: customers.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(customers)
      .where(and(...base))
      .groupBy(customers.status),
  ]);

  const counts: Record<'all' | 'none' | CustomerStatus, number> = {
    all: 0,
    none: 0,
    lead: 0,
    contacted: 0,
    interested: 0,
    customer: 0,
    former_customer: 0,
    not_interested: 0,
  };
  for (const row of statusCounts) {
    counts[row.status ?? 'none'] = row.count;
    counts.all += row.count;
  }
  // A page past the end has no rows to carry the window count: the counts say how many there are.
  const total = items[0]?.total ?? (input.status ? counts[input.status] : counts.all);
  return {
    items: items.map((item) => omit(item, 'total')),
    total,
    page: input.page,
    pageSize: input.pageSize,
    counts,
  };
}

/** Everything the detail shows: the customer, its classification by name, tags and contacts. */
export async function getCustomer(db: Db | Tx, id: string) {
  const owner = sql<{
    id: string;
    name: string;
  } | null>`(select json_build_object('id', u.id, 'name', u.name) from users u where u.id = "customers"."owner_user_id")`;
  const createdBy = sql<
    string | null
  >`(select u.name from users u where u.id = "customers"."created_by_user_id")`;
  const [row] = await db
    .select({
      customer: customers,
      contactTypeName: contactTypes.name,
      products: productsJson,
      sourceName: customerSources.name,
      owner,
      createdBy,
      tags: tagsJson,
    })
    .from(customers)
    .innerJoin(contactTypes, eq(contactTypes.id, customers.contactTypeId))
    .leftJoin(customerSources, eq(customerSources.id, customers.sourceId))
    .where(and(eq(customers.id, id), alive));
  if (!row) throw new CustomerError('NOT_FOUND');
  const people = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.customerId, id), aliveContact))
    .orderBy(desc(contacts.isPrimary), asc(contacts.createdAt));
  const { customer, ...rest } = row;
  return {
    ...omit(customer, 'deletedAt'),
    ...rest,
    contacts: people.map((contact) => omit(contact, 'deletedAt')),
  };
}

/** The tags by name, made when new; their ids. */
async function tagIds(tx: Tx, names: readonly string[]): Promise<string[]> {
  const unique = [...new Map(names.map((n) => [n.toLocaleLowerCase('sk'), n])).values()];
  if (unique.length === 0) return [];
  await tx
    .insert(tags)
    .values(unique.map((name) => ({ name })))
    .onConflictDoNothing();
  const rows = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(
      inArray(
        sql`lower(${tags.name})`,
        unique.map((n) => n.toLocaleLowerCase('sk')),
      ),
    );
  return rows.map((r) => r.id);
}

/** The customer's tags as named; answers which tag ids were added and which removed. */
async function setTags(tx: Tx, customerId: string, names: readonly string[]) {
  const before = (
    await tx
      .select({ id: customerTags.tagId })
      .from(customerTags)
      .where(eq(customerTags.customerId, customerId))
  ).map((row) => row.id);
  const ids = [...new Set(await tagIds(tx, names))];
  await tx.delete(customerTags).where(eq(customerTags.customerId, customerId));
  if (ids.length > 0) {
    await tx.insert(customerTags).values(ids.map((tagId) => ({ customerId, tagId })));
  }
  return {
    added: ids.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !ids.includes(id)),
  };
}

/**
 * The record's products as picked (an id that is not a product is left out); answers which were
 * added and which removed.
 */
async function setProducts(tx: Tx, customerId: string, picked: readonly string[]) {
  const before = (
    await tx
      .select({ id: customerProducts.productId })
      .from(customerProducts)
      .where(eq(customerProducts.customerId, customerId))
  ).map((row) => row.id);
  const ids =
    picked.length === 0
      ? []
      : (
          await tx
            .select({ id: products.id })
            .from(products)
            .where(inArray(products.id, [...new Set(picked)]))
        ).map((row) => row.id);
  await tx.delete(customerProducts).where(eq(customerProducts.customerId, customerId));
  if (ids.length > 0) {
    await tx.insert(customerProducts).values(ids.map((productId) => ({ customerId, productId })));
  }
  return {
    added: ids.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !ids.includes(id)),
  };
}

async function assertIcoFree(tx: Tx, ico: string | undefined, except?: string) {
  if (!ico) return;
  const [taken] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.ico, ico), alive));
  if (taken && taken.id !== except) throw new CustomerError('ICO_TAKEN');
}

/** Whether the contact type is „Zákazník“, the one type with a sales status. */
async function hasSalesStatus(tx: Tx, contactTypeId: string) {
  const [type] = await tx
    .select({ systemKey: contactTypes.systemKey })
    .from(contactTypes)
    .where(eq(contactTypes.id, contactTypeId));
  if (!type) throw new CustomerError('CONTACT_TYPE_UNKNOWN');
  return type.systemKey === 'customer';
}

/** The columns of a customer from the form; the status only for a „Zákazník“. */
function columnsOf(input: CustomerInput, salesStatus: boolean) {
  const common = {
    contactTypeId: input.contactTypeId,
    status: salesStatus ? (input.status ?? null) : null,
    street: input.street ?? null,
    postalCode: input.postalCode ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    ownerUserId: input.ownerUserId ?? null,
    sourceId: input.sourceId ?? null,
    note: input.note ?? null,
    almaOrganizationId: input.almaOrganizationId ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
  };
  if (input.kind === 'organization') {
    return {
      ...common,
      kind: input.kind,
      name: input.name,
      ico: input.ico ?? null,
      dic: input.dic ?? null,
      icDph: input.icDph ?? null,
      web: input.web ?? null,
    };
  }
  return {
    ...common,
    kind: input.kind,
    name: personName(input),
    titleBefore: input.titleBefore ?? null,
    firstName: input.firstName,
    lastName: input.lastName,
    titleAfter: input.titleAfter ?? null,
    gender: input.gender ?? null,
    salutation: input.salutation ?? null,
  };
}

function contactColumns(input: ContactInput) {
  return {
    titleBefore: input.titleBefore ?? null,
    firstName: input.firstName,
    lastName: input.lastName,
    titleAfter: input.titleAfter ?? null,
    gender: input.gender ?? null,
    salutation: input.salutation ?? null,
    position: input.position ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    note: input.note ?? null,
  };
}

/** The unique index on a contact's e-mail within a customer, by name. */
const isContactEmailClash = (error: unknown) =>
  error instanceof Error &&
  (error as { constraint?: string; cause?: { constraint?: string } }).constraint ===
    'contacts_email_unique';
const constraintOf = (error: unknown) =>
  (error as { constraint?: string; cause?: { constraint?: string } } | null)?.constraint ??
  (error as { cause?: { constraint?: string } } | null)?.cause?.constraint;

/** Turns a clash on a unique index into the refusal the web words. */
async function mapUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const constraint = constraintOf(error);
    if (constraint === 'contacts_email_unique' || isContactEmailClash(error))
      throw new CustomerError('CONTACT_EMAIL_TAKEN');
    if (constraint === 'customers_ico_unique') throw new CustomerError('ICO_TAKEN');
    throw error;
  }
}

/** A new customer and, for an organization, its first contact as the primary one. */
export async function createCustomer(db: Db, userId: string, input: CreateCustomerInput) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      const values = columnsOf(
        input.customer,
        await hasSalesStatus(tx, input.customer.contactTypeId),
      );
      await assertIcoFree(
        tx,
        input.customer.kind === 'organization' ? input.customer.ico : undefined,
      );
      const unsubscribed =
        input.customer.kind === 'individual' && !input.customer.receivesBulk
          ? { unsubscribedAt: new Date(), unsubscribeSource: 'manual' as const }
          : {};
      const [created] = await tx
        .insert(customers)
        .values({ ...values, ...unsubscribed, createdByUserId: userId })
        .returning({ id: customers.id });
      const { added } = await setTags(tx, created!.id, input.customer.tags);
      const productChange = await setProducts(tx, created!.id, input.customer.productIds);
      await createCustomerFolder(tx, created!.id);
      if (input.firstContact && input.customer.kind === 'organization') {
        await tx.insert(contacts).values({
          ...contactColumns(input.firstContact),
          customerId: created!.id,
          isPrimary: true,
        });
      }
      return {
        id: created!.id,
        status: values.status,
        tagsAdded: added,
        productsAdded: productChange.added,
      };
    }),
  );
}

/** The fields whose value changed, for the audit trail (names only, never values). */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after)
    .filter((key) => {
      const a = before[key] ?? null;
      const b = after[key] ?? null;
      return a instanceof Date || b instanceof Date
        ? (a as Date | null)?.getTime() !== (b as Date | null)?.getTime()
        : a !== b;
    })
    .sort();
}

export async function updateCustomer(db: Db, id: string, input: CustomerInput) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), alive))
        .for('update');
      if (!current) throw new CustomerError('NOT_FOUND');
      if (current.kind !== input.kind) throw new CustomerError('KIND_CHANGED');
      await assertIcoFree(tx, input.kind === 'organization' ? input.ico : undefined, id);
      const values = columnsOf(input, await hasSalesStatus(tx, input.contactTypeId));
      const fields = changedFields(current, values).filter((f) => f !== 'kind');
      const unsubscribe =
        input.kind === 'individual'
          ? input.receivesBulk
            ? { unsubscribedAt: null, unsubscribeSource: null }
            : current.unsubscribedAt
              ? {}
              : { unsubscribedAt: new Date(), unsubscribeSource: 'manual' as const }
          : {};
      await tx
        .update(customers)
        .set({ ...values, ...unsubscribe, updatedAt: new Date() })
        .where(eq(customers.id, id));
      const tagChange = await setTags(tx, id, input.tags);
      if (tagChange.added.length + tagChange.removed.length > 0) fields.push('tags');
      const productChange = await setProducts(tx, id, input.productIds);
      if (productChange.added.length + productChange.removed.length > 0) fields.push('products');
      return {
        fields: fields.sort(),
        status: { before: current.status, after: values.status },
        ownerUserId: { before: current.ownerUserId, after: values.ownerUserId },
        contactTypeId: { before: current.contactTypeId, after: values.contactTypeId },
        sourceId: { before: current.sourceId, after: values.sourceId },
        tagsAdded: tagChange.added,
        tagsRemoved: tagChange.removed,
        productsAdded: productChange.added,
        productsRemoved: productChange.removed,
      };
    }),
  );
}

export async function deleteCustomer(db: Db, id: string) {
  const [row] = await db
    .update(customers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(customers.id, id), alive))
    .returning({ id: customers.id });
  if (!row) throw new CustomerError('NOT_FOUND');
}

/** Adds one tag (made when new) to every picked customer; how many there were. */
export async function bulkAddTag(db: Db, ids: string[], name: string) {
  return db.transaction(async (tx) => {
    const [tagId] = await tagIds(tx, [name]);
    const live = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(inArray(customers.id, ids), alive));
    if (live.length > 0) {
      await tx
        .insert(customerTags)
        .values(live.map((c) => ({ customerId: c.id, tagId: tagId! })))
        .onConflictDoNothing();
    }
    return { ids: live.map((c) => c.id), tagId: tagId! };
  });
}

/** The status of the picked records that are a „Zákazník“; the others have none and are left. */
export async function bulkSetStatus(db: Db, ids: string[], status: CustomerStatus) {
  const rows = await db
    .update(customers)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        inArray(customers.id, ids),
        alive,
        sql`${customers.contactTypeId} in (select id from contact_types where system_key = 'customer')`,
      ),
    )
    .returning({ id: customers.id });
  return rows.map((r) => r.id);
}

/** The rows of a CSV export: the picked customers, or everything the filters find. */
export async function exportRows(
  db: Db | Tx,
  filter: CustomerFilter & { ids?: string[] | undefined },
) {
  const where = filter.ids
    ? [alive, inArray(customers.id, filter.ids)]
    : [...filterWhere(filter), ...statusWhere(filter.status)];
  const primary = sql<{
    name: string;
    email: string | null;
    phone: string | null;
    salutation: string | null;
  } | null>`case when ${customers.kind} = 'individual'
    then json_build_object('name', ${customers.name}, 'email', ${customers.email}, 'phone', ${customers.phone}, 'salutation', ${customers.salutation})
    else (select json_build_object(
        'name', concat_ws(' ', p.title_before, p.first_name, p.last_name),
        'email', p.email, 'phone', p.phone, 'salutation', p.salutation)
      from contacts p
      where p.customer_id = ${CUSTOMER_ID} and p.is_primary and p.deleted_at is null)
    end`;
  return db
    .select({
      name: customers.name,
      kind: customers.kind,
      contactType: contactTypes.name,
      products: productsJson,
      status: customers.status,
      ico: customers.ico,
      dic: customers.dic,
      icDph: customers.icDph,
      street: customers.street,
      postalCode: customers.postalCode,
      city: customers.city,
      region: customers.region,
      email: customers.email,
      phone: customers.phone,
      web: customers.web,
      owner: users.name,
      source: customerSources.name,
      tags: tagsJson,
      primary,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .innerJoin(contactTypes, eq(contactTypes.id, customers.contactTypeId))
    .leftJoin(customerSources, eq(customerSources.id, customers.sourceId))
    .leftJoin(users, eq(users.id, customers.ownerUserId))
    .where(and(...where))
    .orderBy(collated(customers.name), asc(customers.id));
}

/**
 * The audit trail of one customer, newest first: its own events and the bulk changes that named
 * it. Values only as the allow-list kept them.
 */
export async function customerHistory(db: Db | Tx, id: string) {
  const rows = await db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      action: auditEvents.action,
      diff: auditEvents.diff,
      userName: users.name,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.userId))
    .where(
      and(
        eq(auditEvents.entityType, 'customer'),
        eq(auditEvents.kind, 'mutation'),
        or(
          eq(auditEvents.entityId, id),
          sql`jsonb_typeof(${auditEvents.diff} -> 'ids') = 'array' and jsonb_exists(${auditEvents.diff} -> 'ids', ${id})`,
        ),
        sql`${auditEvents.action} not like '%.failed' and ${auditEvents.action} not like '%.denied'`,
      ),
    )
    .orderBy(desc(auditEvents.at))
    .limit(50);
  const events = rows as {
    id: string;
    at: Date;
    action: string;
    diff: Record<string, unknown> | null;
    userName: string | null;
  }[];
  const names = await namesOf(
    db,
    events.map((event) => event.diff),
  );
  return events.map((event) => ({ ...event, names }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id an event's diff names: a value, a before/after pair, or a list of them. */
function idsIn(value: unknown, into: Set<string>) {
  if (typeof value === 'string' && UUID_RE.test(value)) into.add(value);
  else if (Array.isArray(value)) value.forEach((item) => idsIn(item, into));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => idsIn(item, into));
}

/**
 * The names behind the ids of a history (tags, contacts, colleagues, products, sources), resolved
 * when it is read: the append-only trail keeps ids only, never a name somebody typed. A deleted
 * contact keeps its name here; a tag deleted since is simply not named.
 */
async function namesOf(db: Db | Tx, diffs: (Record<string, unknown> | null)[]) {
  const ids = new Set<string>();
  for (const diff of diffs) idsIn(diff, ids);
  const list = [...ids];
  if (list.length === 0) return {} as Record<string, string>;
  const [tagRows, contactRows, userRows, productRows, sourceRows, contactTypeRows] =
    await Promise.all([
      db.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, list)),
      db
        .select({
          id: contacts.id,
          titleBefore: contacts.titleBefore,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          titleAfter: contacts.titleAfter,
        })
        .from(contacts)
        .where(inArray(contacts.id, list)),
      db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list)),
      db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(inArray(products.id, list)),
      db
        .select({ id: customerSources.id, name: customerSources.name })
        .from(customerSources)
        .where(inArray(customerSources.id, list)),
      db
        .select({ id: contactTypes.id, name: contactTypes.name })
        .from(contactTypes)
        .where(inArray(contactTypes.id, list)),
    ]);
  return Object.fromEntries([
    ...tagRows.map((row) => [row.id, row.name]),
    ...contactRows.map((row) => [row.id, personName(row)]),
    ...userRows.map((row) => [row.id, row.name]),
    ...productRows.map((row) => [row.id, row.name]),
    ...sourceRows.map((row) => [row.id, row.name]),
    ...contactTypeRows.map((row) => [row.id, row.name]),
  ]) as Record<string, string>;
}

/** The owner a contact belongs to; contacts exist for organizations only. */
async function organizationOf(tx: Tx, customerId: string) {
  const [row] = await tx
    .select({ kind: customers.kind })
    .from(customers)
    .where(and(eq(customers.id, customerId), alive))
    .for('update');
  if (!row) throw new CustomerError('NOT_FOUND');
  if (row.kind !== 'organization') throw new CustomerError('NOT_ORGANIZATION');
}

/** A new contact; the first one of a customer becomes its primary contact. */
export async function createContact(db: Db, customerId: string, input: ContactInput) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      await organizationOf(tx, customerId);
      const [primary] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(eq(contacts.customerId, customerId), eq(contacts.isPrimary, true), aliveContact),
        );
      const [created] = await tx
        .insert(contacts)
        .values({ ...contactColumns(input), customerId, isPrimary: !primary })
        .returning({ id: contacts.id });
      await touch(tx, customerId);
      return { id: created!.id, customerId };
    }),
  );
}

const touch = (tx: Tx, customerId: string) =>
  tx.update(customers).set({ updatedAt: new Date() }).where(eq(customers.id, customerId));

async function liveContact(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), aliveContact))
    .for('update');
  if (!row) throw new CustomerError('NOT_FOUND');
  return row;
}

export async function updateContact(
  db: Db,
  id: string,
  input: ContactInput,
  receivesBulk: boolean,
) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      const current = await liveContact(tx, id);
      const values = contactColumns(input);
      const fields = changedFields(current, values);
      const unsubscribe = receivesBulk
        ? { unsubscribedAt: null, unsubscribeSource: null }
        : current.unsubscribedAt
          ? {}
          : { unsubscribedAt: new Date(), unsubscribeSource: 'manual' as const };
      if (receivesBulk === (current.unsubscribedAt !== null)) fields.push('receivesBulk');
      await tx
        .update(contacts)
        .set({ ...values, ...unsubscribe, updatedAt: new Date() })
        .where(eq(contacts.id, id));
      await touch(tx, current.customerId);
      return { customerId: current.customerId, fields: fields.sort() };
    }),
  );
}

export async function setPrimaryContact(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const current = await liveContact(tx, id);
    await tx
      .update(contacts)
      .set({ isPrimary: false })
      .where(and(eq(contacts.customerId, current.customerId), eq(contacts.isPrimary, true)));
    await tx
      .update(contacts)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(contacts.id, id));
    await touch(tx, current.customerId);
    return { customerId: current.customerId };
  });
}

/** Removes a contact; when it was the primary one, the oldest remaining contact takes over. */
export async function deleteContact(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const current = await liveContact(tx, id);
    await tx
      .update(contacts)
      .set({ deletedAt: new Date(), isPrimary: false, updatedAt: new Date() })
      .where(eq(contacts.id, id));
    if (current.isPrimary) {
      const [next] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.customerId, current.customerId), aliveContact))
        .orderBy(asc(contacts.createdAt))
        .limit(1);
      if (next) await tx.update(contacts).set({ isPrimary: true }).where(eq(contacts.id, next.id));
    }
    await touch(tx, current.customerId);
    return { customerId: current.customerId };
  });
}

/** What the forms and filters offer: contact types, products, sources, tags and the active users. */
export async function formOptions(db: Db | Tx) {
  const [contactTypeRows, productRows, sources, tagRows, people] = await Promise.all([
    db
      .select({
        id: contactTypes.id,
        name: contactTypes.name,
        active: contactTypes.active,
        systemKey: contactTypes.systemKey,
      })
      .from(contactTypes)
      .orderBy(asc(contactTypes.position), collated(contactTypes.name)),
    db
      .select({ id: products.id, name: products.name, active: products.active })
      .from(products)
      .orderBy(asc(products.position), collated(products.name)),
    db
      .select({
        id: customerSources.id,
        name: customerSources.name,
        active: customerSources.active,
      })
      .from(customerSources)
      .orderBy(asc(customerSources.position), collated(customerSources.name)),
    db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(collated(tags.name)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.status, 'active'), isNull(users.deletedAt)))
      .orderBy(collated(users.name)),
  ]);
  return {
    contactTypes: contactTypeRows,
    products: productRows,
    sources,
    tags: tagRows,
    users: people,
  };
}

/** The live customers a filter finds, by name, at most `limit` (a segment's recipients). */
export async function customerIdsMatching(db: Db | Tx, filter: CustomerFilter, limit: number) {
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(...filterWhere(filter), ...statusWhere(filter.status)))
    .orderBy(collated(customers.name), asc(customers.id))
    .limit(limit);
  return rows.map((row) => row.id);
}
