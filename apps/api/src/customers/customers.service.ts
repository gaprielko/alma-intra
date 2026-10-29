import { personName } from '@intra/shared/schemas';
import type {
  ContactInput,
  CreateCustomerInput,
  CreateEstablishmentInput,
  EstablishmentInput,
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
  contactLinks,
  contacts,
  organizationSources,
  organizations,
  organizationTags,
  organizationProducts,
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
      /** A prevádzka cannot have prevádzky, nor can a private person (one level, a company). */
      | 'NOT_PARENT'
      /** What only an organization has (role, IČO, classification) is changed at the organization. */
      | 'IS_ESTABLISHMENT'
      /** The prevádzka form edits prevádzky only. */
      | 'NOT_ESTABLISHMENT',
  ) {
    super(code);
  }
}

const alive = isNull(organizations.deletedAt);
const aliveContact = isNull(contacts.deletedAt);
/** Names sorted as a Slovak reader expects: case and accents in their places. */
const collated = (column: SQL | AnyColumn) => sql`${column} collate "sk-x-icu"`;

/**
 * The customer's id, always qualified: Drizzle writes columns bare in a single-table query, and a
 * bare `id` inside a correlated subquery would name the subquery's own table.
 */
const CUSTOMER_ID = sql.raw('"organizations"."id"');

/** `%text%` for ILIKE, with the wildcards somebody typed taken literally. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Any of the values, `none` standing for an empty column. */
function anyOf<T extends string>(column: AnyColumn, values: readonly (T | 'none')[] | undefined) {
  if (!values || values.length === 0) return [];
  const listed = values.filter((v): v is T => v !== 'none');
  const parts = [
    ...(listed.length > 0 ? [inArray(column, listed)] : []),
    ...(values.includes('none') ? [isNull(column)] : []),
  ];
  return [parts.length === 1 ? parts[0]! : or(...parts)!];
}

/** The status filter: statuses, `none` for the records without one. */
const statusWhere = (status: CustomerFilter['status']) => anyOf(organizations.status, status);

/** The records linked to any of the ids in a join table, or (`none`) to none at all. */
function linkedTo(
  table: 'organization_products' | 'organization_tags',
  column: string,
  values: readonly string[] | undefined,
) {
  if (!values || values.length === 0) return [];
  const ids = values.filter((v) => v !== 'none');
  const parts: SQL[] = [];
  if (ids.length > 0) {
    parts.push(
      sql`exists (select 1 from ${sql.raw(table)} x where x.organization_id = ${CUSTOMER_ID} and x.${sql.raw(column)} in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}))`,
    );
  }
  if (values.includes('none')) {
    parts.push(
      sql`not exists (select 1 from ${sql.raw(table)} x where x.organization_id = ${CUSTOMER_ID})`,
    );
  }
  return [parts.length === 1 ? parts[0]! : or(...parts)!];
}

/** The filters of the list as a WHERE clause; `status` is left to the caller (the chips count without it). */
function filterWhere(filter: CustomerFilter): SQL[] {
  // Organizations only: a prevádzka is shown at its organization (docs/establishments.md).
  const where: SQL[] = [alive, isNull(organizations.parentId)];
  if (filter.role) where.push(eq(organizations.role, filter.role));
  where.push(...anyOf(organizations.kind, filter.kind));
  where.push(...linkedTo('organization_products', 'product_id', filter.productId));
  where.push(...anyOf(organizations.region, filter.region));
  where.push(...anyOf(organizations.ownerUserId, filter.ownerUserId));
  where.push(...linkedTo('organization_tags', 'tag_id', filter.tagId));
  if (filter.search) {
    const pattern = likePattern(filter.search);
    const digits = filter.search.replace(/\s/g, '');
    where.push(
      or(
        // Without regard to diacritics either: „Toth“ finds „Tóth“ (migration 0022).
        sql`unaccent(${organizations.name}) ilike unaccent(${pattern})`,
        sql`${organizations.email} ilike ${pattern}`,
        /^\d+$/.test(digits) ? sql`${organizations.ico} like ${likePattern(digits)}` : sql`false`,
        sql`exists (select 1 from contact_links l join contacts p on p.id = l.contact_id
          where l.organization_id = ${CUSTOMER_ID} and p.deleted_at is null
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
  from organization_tags ct join tags t on t.id = ct.tag_id
  where ct.organization_id = ${CUSTOMER_ID}), '[]'::json)`;

/** The record's products, in the order of the code list, as JSON. */
const productsJson = sql<{ id: string; name: string }[]>`coalesce((
  select json_agg(json_build_object('id', p.id, 'name', p.name)
    order by p.position, p.name collate "sk-x-icu")
  from organization_products cp join products p on p.id = cp.product_id
  where cp.organization_id = ${CUSTOMER_ID}), '[]'::json)`;

/** The primary contact: the person at an organization, or a private person themself. */
const primaryContactJson = sql<{
  name: string;
  email: string | null;
} | null>`(select json_build_object(
    'name', concat_ws(' ', p.title_before, p.first_name, p.last_name), 'email', p.email)
  from contact_links l join contacts p on p.id = l.contact_id
  where l.organization_id = ${CUSTOMER_ID} and l.is_primary and p.deleted_at is null)`;

/** The last activity, e-mail sent to the customer or reply received from it. */
export const LAST_CONTACT = sql`greatest(
  (select max(a.occurred_at) from activities a
    where a.organization_id = ${CUSTOMER_ID} and a.deleted_at is null),
  (select max(m.sent_at) from campaign_messages m where m.organization_id = ${CUSTOMER_ID}),
  (select max(i.received_at) from inbound_messages i
    where i.organization_id = ${CUSTOMER_ID} and i.status = 'assigned'))`;

const SORTS = {
  name: collated(organizations.name),
  status: sql`${organizations.status}`,
  createdAt: sql`${organizations.createdAt}`,
  updatedAt: sql`${organizations.updatedAt}`,
  lastContact: LAST_CONTACT,
};

/**
 * One page of the customer list, the number of organizations in each status for the chips (with
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
        id: organizations.id,
        kind: organizations.kind,
        role: organizations.role,
        name: organizations.name,
        city: organizations.city,
        products: productsJson,
        status: organizations.status,
        owner: sql<{ id: string; name: string } | null>`case when ${users.id} is null then null
          else json_build_object('id', ${users.id}, 'name', ${users.name}) end`,
        tags: tagsJson,
        primaryContact: primaryContactJson,
        lastContactAt: sql<string | null>`${LAST_CONTACT}`,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(organizations)
      .leftJoin(users, eq(users.id, organizations.ownerUserId))
      .where(and(...where))
      .orderBy(order, asc(organizations.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({ status: organizations.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(organizations)
      .where(and(...base))
      .groupBy(organizations.status),
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
  const total =
    items[0]?.total ??
    (input.status ? input.status.reduce((sum, status) => sum + counts[status], 0) : counts.all);
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
  } | null>`(select json_build_object('id', u.id, 'name', u.name) from users u where u.id = "organizations"."owner_user_id")`;
  const createdBy = sql<
    string | null
  >`(select u.name from users u where u.id = "organizations"."created_by_user_id")`;
  const [row] = await db
    .select({
      customer: organizations,
      products: productsJson,
      sourceName: organizationSources.name,
      owner,
      createdBy,
      tags: tagsJson,
    })
    .from(organizations)
    .leftJoin(organizationSources, eq(organizationSources.id, organizations.sourceId))
    .where(and(eq(organizations.id, id), alive));
  if (!row) throw new CustomerError('NOT_FOUND');
  const [people, parent, [established]] = await Promise.all([
    personsOf(db, id),
    row.customer.parentId ? parentSummary(db, row.customer.parentId) : Promise.resolve(null),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(organizations)
      .where(and(eq(organizations.parentId, id), alive)),
  ]);
  const { customer, ...rest } = row;
  const self = customer.kind === 'individual' ? people.find((p) => p.isPrimary) : undefined;
  return {
    ...omit(customer, 'deletedAt'),
    ...rest,
    // A private person's own fields, from their person (stage O2 keeps the old shape).
    ...personFieldsOf(self),
    email: self ? self.email : customer.email,
    phone: self ? self.phone : customer.phone,
    /** A private person's own person in Kontakty. */
    personId: self?.id ?? null,
    contacts: customer.kind === 'individual' ? [] : people,
    /** A prevádzka's organization: what it shares (IČO, role, status, owner, tags). */
    parent,
    establishmentCount: established?.count ?? 0,
  };
}

/** What a prevádzka shows of its organization. */
async function parentSummary(db: Db | Tx, parentId: string) {
  const [parent] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      ico: organizations.ico,
      role: organizations.role,
      status: organizations.status,
      owner: sql<{ id: string; name: string } | null>`case when ${users.id} is null then null
        else json_build_object('id', ${users.id}, 'name', ${users.name}) end`,
      tags: tagsJson,
    })
    .from(organizations)
    .leftJoin(users, eq(users.id, organizations.ownerUserId))
    .where(eq(organizations.id, parentId));
  return parent ?? null;
}

/** The live persons of an organization with their position there, the primary one first. */
async function personsOf(db: Db | Tx, organizationId: string) {
  const rows = await db
    .select({
      contact: contacts,
      position: contactLinks.position,
      isPrimary: contactLinks.isPrimary,
      // The person's other live organizations: „aj v …“ on the card.
      elsewhere: sql<{ id: string; name: string; role: 'customer' | 'partner' }[]>`coalesce((
        select json_agg(json_build_object('id', o.id, 'name', o.name, 'role', o.role)
          order by o.name collate "sk-x-icu")
        from contact_links l join organizations o on o.id = l.organization_id
        where l.contact_id = ${contacts.id} and l.organization_id <> ${organizationId}
          and o.deleted_at is null), '[]'::json)`,
    })
    .from(contactLinks)
    .innerJoin(contacts, eq(contacts.id, contactLinks.contactId))
    .where(and(eq(contactLinks.organizationId, organizationId), aliveContact))
    .orderBy(desc(contactLinks.isPrimary), asc(contacts.createdAt));
  return rows.map(({ contact, position, isPrimary, elsewhere }) => ({
    ...omit(contact, 'deletedAt'),
    position,
    isPrimary,
    elsewhere,
  }));
}

function personFieldsOf(person: Awaited<ReturnType<typeof personsOf>>[number] | undefined) {
  return {
    titleBefore: person?.titleBefore ?? null,
    firstName: person?.firstName ?? null,
    lastName: person?.lastName ?? null,
    titleAfter: person?.titleAfter ?? null,
    gender: person?.gender ?? null,
    salutation: person?.salutation ?? null,
    emailStatus: person?.emailStatus ?? ('ok' as const),
    unsubscribedAt: person?.unsubscribedAt ?? null,
    unsubscribeSource: person?.unsubscribeSource ?? null,
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
      .select({ id: organizationTags.tagId })
      .from(organizationTags)
      .where(eq(organizationTags.organizationId, customerId))
  ).map((row) => row.id);
  const ids = [...new Set(await tagIds(tx, names))];
  await tx.delete(organizationTags).where(eq(organizationTags.organizationId, customerId));
  if (ids.length > 0) {
    await tx
      .insert(organizationTags)
      .values(ids.map((tagId) => ({ organizationId: customerId, tagId })));
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
      .select({ id: organizationProducts.productId })
      .from(organizationProducts)
      .where(eq(organizationProducts.organizationId, customerId))
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
  await tx.delete(organizationProducts).where(eq(organizationProducts.organizationId, customerId));
  if (ids.length > 0) {
    await tx
      .insert(organizationProducts)
      .values(ids.map((productId) => ({ organizationId: customerId, productId })));
  }
  return {
    added: ids.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !ids.includes(id)),
  };
}

async function assertIcoFree(tx: Tx, ico: string | undefined, except?: string) {
  if (!ico) return;
  const [taken] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.ico, ico), alive));
  if (taken && taken.id !== except) throw new CustomerError('ICO_TAKEN');
}

/** The columns of a record from the form; status and owner a customer's only (D-10). */
function columnsOf(input: CustomerInput) {
  const customer = input.role === 'customer';
  const common = {
    role: input.role,
    status: customer ? (input.status ?? null) : null,
    street: input.street ?? null,
    postalCode: input.postalCode ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    ownerUserId: customer ? (input.ownerUserId ?? null) : null,
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
  // A private person's e-mail and phone are their person's.
  return { ...common, kind: input.kind, name: personName(input), email: null, phone: null };
}

/** The person of a private-person record, from the form. */
function selfColumns(input: Extract<CustomerInput, { kind: 'individual' }>) {
  return {
    titleBefore: input.titleBefore ?? null,
    firstName: input.firstName,
    lastName: input.lastName,
    titleAfter: input.titleAfter ?? null,
    gender: input.gender ?? null,
    salutation: input.salutation ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
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
    email: input.email ?? null,
    phone: input.phone ?? null,
    note: input.note ?? null,
  };
}

/** The unique index on a person's e-mail (D-7), by name. */
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
    if (constraint === 'organizations_ico_unique') throw new CustomerError('ICO_TAKEN');
    throw error;
  }
}

/** A new customer and, for an organization, its first contact as the primary one. */
export async function createCustomer(db: Db, userId: string, input: CreateCustomerInput) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      const values = columnsOf(input.customer);
      await assertIcoFree(
        tx,
        input.customer.kind === 'organization' ? input.customer.ico : undefined,
      );
      const [created] = await tx
        .insert(organizations)
        .values({ ...values, createdByUserId: userId })
        .returning({ id: organizations.id });
      if (input.customer.kind === 'individual') {
        const unsubscribed = input.customer.receivesBulk
          ? {}
          : { unsubscribedAt: new Date(), unsubscribeSource: 'manual' as const };
        const [person] = await tx
          .insert(contacts)
          .values({ ...selfColumns(input.customer), ...unsubscribed })
          .returning({ id: contacts.id });
        await tx
          .insert(contactLinks)
          .values({ contactId: person!.id, organizationId: created!.id, isPrimary: true });
      }
      const { added } = await setTags(tx, created!.id, input.customer.tags);
      const productChange = await setProducts(
        tx,
        created!.id,
        input.customer.role === 'customer' ? input.customer.productIds : [],
      );
      await createCustomerFolder(tx, created!.id);
      if (input.firstContact && input.customer.kind === 'organization') {
        const [person] = await tx
          .insert(contacts)
          .values(contactColumns(input.firstContact))
          .returning({ id: contacts.id });
        await tx.insert(contactLinks).values({
          contactId: person!.id,
          organizationId: created!.id,
          position: input.firstContact.position ?? null,
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
        .from(organizations)
        .where(and(eq(organizations.id, id), alive))
        .for('update');
      if (!current) throw new CustomerError('NOT_FOUND');
      if (current.parentId) throw new CustomerError('IS_ESTABLISHMENT');
      if (current.kind !== input.kind) throw new CustomerError('KIND_CHANGED');
      await assertIcoFree(tx, input.kind === 'organization' ? input.ico : undefined, id);
      const values = columnsOf(input);
      const fields = changedFields(current, values).filter((f) => f !== 'kind');
      await tx
        .update(organizations)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(organizations.id, id));
      if (input.kind === 'individual') {
        const [self] = await personsOf(tx, id);
        if (self) {
          const person = selfColumns(input);
          fields.push(...changedFields(self, person).filter((f) => !fields.includes(f)));
          const unsubscribe = input.receivesBulk
            ? { unsubscribedAt: null, unsubscribeSource: null }
            : self.unsubscribedAt
              ? {}
              : { unsubscribedAt: new Date(), unsubscribeSource: 'manual' as const };
          await tx
            .update(contacts)
            .set({ ...person, ...unsubscribe, updatedAt: new Date() })
            .where(eq(contacts.id, self.id));
        }
      }
      const tagChange = await setTags(tx, id, input.tags);
      if (tagChange.added.length + tagChange.removed.length > 0) fields.push('tags');
      const productChange = await setProducts(
        tx,
        id,
        input.role === 'customer' ? input.productIds : [],
      );
      if (productChange.added.length + productChange.removed.length > 0) fields.push('products');
      return {
        fields: fields.sort(),
        status: { before: current.status, after: values.status },
        ownerUserId: { before: current.ownerUserId, after: values.ownerUserId },
        role: { before: current.role, after: values.role },
        sourceId: { before: current.sourceId, after: values.sourceId },
        tagsAdded: tagChange.added,
        tagsRemoved: tagChange.removed,
        productsAdded: productChange.added,
        productsRemoved: productChange.removed,
      };
    }),
  );
}

/**
 * A partner becomes a customer, or a customer a partner (D-5): the history, persons, files and
 * segments stay. A partner has no status, owner or products, so a customer turned partner loses
 * them (the history of changes keeps them).
 */
export async function setRole(db: Db, id: string, role: 'customer' | 'partner') {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ role: organizations.role, parentId: organizations.parentId })
      .from(organizations)
      .where(and(eq(organizations.id, id), alive))
      .for('update');
    if (!current) throw new CustomerError('NOT_FOUND');
    if (current.parentId) throw new CustomerError('IS_ESTABLISHMENT');
    if (current.role === role) return { changed: false, productsRemoved: [] as string[] };
    await tx
      .update(organizations)
      .set({
        role,
        ...(role === 'partner' ? { status: null, ownerUserId: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id));
    // Its prevádzky share the role.
    await tx
      .update(organizations)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(organizations.parentId, id), alive));
    const productsRemoved =
      role === 'partner' ? (await setProducts(tx, id, [])).removed : ([] as string[]);
    return { changed: true, productsRemoved };
  });
}

/** Soft: an organization's prevádzky go with it; a prevádzka alone answers its organization. */
export async function deleteCustomer(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(organizations)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(organizations.id, id), alive))
      .returning({ id: organizations.id, parentId: organizations.parentId });
    if (!row) throw new CustomerError('NOT_FOUND');
    if (!row.parentId) {
      await tx
        .update(organizations)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(organizations.parentId, id), alive));
    }
    return { parentId: row.parentId };
  });
}

/** Adds one tag (made when new) to every picked customer; how many there were. */
export async function bulkAddTag(db: Db, ids: string[], name: string) {
  return db.transaction(async (tx) => {
    const [tagId] = await tagIds(tx, [name]);
    const live = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(inArray(organizations.id, ids), alive));
    if (live.length > 0) {
      await tx
        .insert(organizationTags)
        .values(live.map((c) => ({ organizationId: c.id, tagId: tagId! })))
        .onConflictDoNothing();
    }
    return { ids: live.map((c) => c.id), tagId: tagId! };
  });
}

/** The status of the picked records that are a „Zákazník“; the others have none and are left. */
export async function bulkSetStatus(db: Db, ids: string[], status: CustomerStatus) {
  const rows = await db
    .update(organizations)
    .set({ status, updatedAt: new Date() })
    .where(and(inArray(organizations.id, ids), alive, eq(organizations.role, 'customer')))
    .returning({ id: organizations.id });
  return rows.map((r) => r.id);
}

/** The rows of a CSV export: the picked organizations, or everything the filters find. */
export async function exportRows(
  db: Db | Tx,
  filter: CustomerFilter & { ids?: string[] | undefined },
) {
  const where = filter.ids
    ? [alive, inArray(organizations.id, filter.ids)]
    : [...filterWhere(filter), ...statusWhere(filter.status)];
  const primary = sql<{
    name: string;
    email: string | null;
    phone: string | null;
    salutation: string | null;
  } | null>`(select json_build_object(
      'name', concat_ws(' ', p.title_before, p.first_name, p.last_name),
      'email', p.email, 'phone', p.phone, 'salutation', p.salutation)
    from contact_links l join contacts p on p.id = l.contact_id
    where l.organization_id = ${CUSTOMER_ID} and l.is_primary and p.deleted_at is null)`;
  return db
    .select({
      name: organizations.name,
      kind: organizations.kind,
      role: organizations.role,
      products: productsJson,
      status: organizations.status,
      ico: organizations.ico,
      dic: organizations.dic,
      icDph: organizations.icDph,
      street: organizations.street,
      postalCode: organizations.postalCode,
      city: organizations.city,
      region: organizations.region,
      email: organizations.email,
      phone: organizations.phone,
      web: organizations.web,
      owner: users.name,
      source: organizationSources.name,
      tags: tagsJson,
      primary,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .leftJoin(organizationSources, eq(organizationSources.id, organizations.sourceId))
    .leftJoin(users, eq(users.id, organizations.ownerUserId))
    .where(and(...where))
    .orderBy(collated(organizations.name), asc(organizations.id));
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
  const [tagRows, contactRows, userRows, productRows, sourceRows, organizationRows] =
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
        .select({ id: organizationSources.id, name: organizationSources.name })
        .from(organizationSources)
        .where(inArray(organizationSources.id, list)),
      db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(inArray(organizations.id, list)),
    ]);
  return Object.fromEntries([
    ...organizationRows.map((row) => [row.id, row.name]),
    ...tagRows.map((row) => [row.id, row.name]),
    ...contactRows.map((row) => [row.id, personName(row)]),
    ...userRows.map((row) => [row.id, row.name]),
    ...productRows.map((row) => [row.id, row.name]),
    ...sourceRows.map((row) => [row.id, row.name]),
  ]) as Record<string, string>;
}

/** The owner a contact belongs to; contacts exist for organizations only. */
async function organizationOf(tx: Tx, customerId: string) {
  const [row] = await tx
    .select({ kind: organizations.kind })
    .from(organizations)
    .where(and(eq(organizations.id, customerId), alive))
    .for('update');
  if (!row) throw new CustomerError('NOT_FOUND');
  if (row.kind !== 'organization') throw new CustomerError('NOT_ORGANIZATION');
}

/** A new person at an organization; the first one becomes its primary contact. */
export async function createContact(db: Db, customerId: string, input: ContactInput) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      await organizationOf(tx, customerId);
      const [primary] = await tx
        .select({ id: contactLinks.contactId })
        .from(contactLinks)
        .where(and(eq(contactLinks.organizationId, customerId), eq(contactLinks.isPrimary, true)));
      const [created] = await tx
        .insert(contacts)
        .values(contactColumns(input))
        .returning({ id: contacts.id });
      await tx.insert(contactLinks).values({
        contactId: created!.id,
        organizationId: customerId,
        position: input.position ?? null,
        isPrimary: !primary,
      });
      await touch(tx, customerId);
      return { id: created!.id, customerId };
    }),
  );
}

const touch = (tx: Tx, customerId: string) =>
  tx.update(organizations).set({ updatedAt: new Date() }).where(eq(organizations.id, customerId));

/** A live person at the organization, with their link there. */
async function liveContact(tx: Tx, id: string, customerId: string) {
  const [row] = await tx
    .select({ contact: contacts, link: contactLinks })
    .from(contacts)
    .innerJoin(
      contactLinks,
      and(eq(contactLinks.contactId, contacts.id), eq(contactLinks.organizationId, customerId)),
    )
    .where(and(eq(contacts.id, id), aliveContact))
    .for('update');
  if (!row) throw new CustomerError('NOT_FOUND');
  return row;
}

export async function updateContact(
  db: Db,
  id: string,
  customerId: string,
  input: ContactInput,
  receivesBulk: boolean,
) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      const { contact: current, link } = await liveContact(tx, id, customerId);
      const values = contactColumns(input);
      const fields = changedFields(current, values);
      const position = input.position ?? null;
      if (position !== link.position) fields.push('position');
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
      await tx
        .update(contactLinks)
        .set({ position })
        .where(and(eq(contactLinks.contactId, id), eq(contactLinks.organizationId, customerId)));
      await touch(tx, customerId);
      return { customerId, fields: fields.sort() };
    }),
  );
}

export async function setPrimaryContact(db: Db, id: string, customerId: string) {
  return db.transaction(async (tx) => {
    await liveContact(tx, id, customerId);
    await tx
      .update(contactLinks)
      .set({ isPrimary: false })
      .where(and(eq(contactLinks.organizationId, customerId), eq(contactLinks.isPrimary, true)));
    await tx
      .update(contactLinks)
      .set({ isPrimary: true })
      .where(and(eq(contactLinks.contactId, id), eq(contactLinks.organizationId, customerId)));
    await touch(tx, customerId);
    return { customerId };
  });
}

/**
 * Takes a person off the organization; when they were its primary contact, the person there the
 * longest takes over. A person left without any organization is removed, as before stage O5.
 */
export async function deleteContact(db: Db, id: string, customerId: string) {
  return db.transaction(async (tx) => {
    const { link } = await liveContact(tx, id, customerId);
    await tx
      .delete(contactLinks)
      .where(and(eq(contactLinks.contactId, id), eq(contactLinks.organizationId, customerId)));
    if (link.isPrimary) {
      const [next] = await tx
        .select({ id: contactLinks.contactId })
        .from(contactLinks)
        .innerJoin(contacts, eq(contacts.id, contactLinks.contactId))
        .where(and(eq(contactLinks.organizationId, customerId), aliveContact))
        .orderBy(asc(contactLinks.createdAt))
        .limit(1);
      if (next) {
        await tx
          .update(contactLinks)
          .set({ isPrimary: true })
          .where(
            and(eq(contactLinks.contactId, next.id), eq(contactLinks.organizationId, customerId)),
          );
      }
    }
    const [elsewhere] = await tx
      .select({ id: contactLinks.organizationId })
      .from(contactLinks)
      .where(eq(contactLinks.contactId, id))
      .limit(1);
    if (!elsewhere) {
      await tx
        .update(contacts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(contacts.id, id));
    }
    await touch(tx, customerId);
    return { customerId };
  });
}

/** What the forms and filters offer: products, sources, tags and the active users. */
export async function formOptions(db: Db | Tx) {
  const [productRows, sources, tagRows, people] = await Promise.all([
    db
      .select({ id: products.id, name: products.name, active: products.active })
      .from(products)
      .orderBy(asc(products.position), collated(products.name)),
    db
      .select({
        id: organizationSources.id,
        name: organizationSources.name,
        active: organizationSources.active,
      })
      .from(organizationSources)
      .orderBy(asc(organizationSources.position), collated(organizationSources.name)),
    db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(collated(tags.name)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.status, 'active'), isNull(users.deletedAt)))
      .orderBy(collated(users.name)),
  ]);
  return {
    products: productRows,
    sources,
    tags: tagRows,
    users: people,
  };
}

/** The live organizations a filter finds, by name, at most `limit` (a segment's recipients). */
export async function customerIdsMatching(db: Db | Tx, filter: CustomerFilter, limit: number) {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(...filterWhere(filter), ...statusWhere(filter.status)))
    .orderBy(collated(organizations.name), asc(organizations.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------------------------
// Prevádzky (docs/establishments.md): rows of `organizations` with a parent, one level.

/** The prevádzka's own columns; the rest stays NULL and is read from its organization. */
function establishmentColumns(input: EstablishmentInput) {
  return {
    name: input.name,
    street: input.street ?? null,
    postalCode: input.postalCode ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    almaOrganizationId: input.almaOrganizationId ?? null,
    note: input.note ?? null,
  };
}

/** The organization a prevádzka is added to: live, a company, not itself a prevádzka. */
async function parentOf(tx: Tx, parentId: string) {
  const [row] = await tx
    .select({
      id: organizations.id,
      kind: organizations.kind,
      role: organizations.role,
      parentId: organizations.parentId,
    })
    .from(organizations)
    .where(and(eq(organizations.id, parentId), alive))
    .for('update');
  if (!row) throw new CustomerError('NOT_FOUND');
  if (row.kind !== 'organization' || row.parentId) throw new CustomerError('NOT_PARENT');
  return row;
}

/** The primary person of a prevádzka, as the table of prevádzky shows them. */
const establishmentPrimaryJson = sql<{
  id: string;
  name: string;
  email: string | null;
} | null>`(select json_build_object(
    'id', p.id, 'name', concat_ws(' ', p.title_before, p.first_name, p.last_name), 'email', p.email)
  from contact_links l join contacts p on p.id = l.contact_id
  where l.organization_id = ${CUSTOMER_ID} and l.is_primary and p.deleted_at is null)`;

/** An organization's live prevádzky, by name, with their primary person and how many persons. */
export async function listEstablishments(db: Db | Tx, parentId: string) {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      street: organizations.street,
      postalCode: organizations.postalCode,
      city: organizations.city,
      region: organizations.region,
      email: organizations.email,
      phone: organizations.phone,
      primaryContact: establishmentPrimaryJson,
      persons:
        sql<number>`(select count(*) from contact_links l join contacts p on p.id = l.contact_id
        where l.organization_id = ${CUSTOMER_ID} and p.deleted_at is null)`.mapWith(Number),
      products: productsJson,
      lastContactAt: sql<string | null>`${LAST_CONTACT}`,
    })
    .from(organizations)
    .where(and(eq(organizations.parentId, parentId), alive))
    .orderBy(collated(organizations.name), asc(organizations.id));
}

/**
 * A new prevádzka of an organization, with its role; its primary contact is a person already in
 * Kontakty (they keep their other links), a new person, or nobody yet.
 */
export async function createEstablishment(db: Db, userId: string, input: CreateEstablishmentInput) {
  return mapUnique(() =>
    db.transaction(async (tx) => {
      const parent = await parentOf(tx, input.parentId);
      const [created] = await tx
        .insert(organizations)
        .values({
          kind: 'organization',
          role: parent.role,
          parentId: parent.id,
          ...establishmentColumns(input.establishment),
          createdByUserId: userId,
        })
        .returning({ id: organizations.id });
      let contactId: string | null = null;
      if (input.primary?.kind === 'existing') {
        const [person] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, input.primary.contactId), aliveContact));
        if (!person) throw new CustomerError('NOT_FOUND');
        await tx.insert(contactLinks).values({
          contactId: person.id,
          organizationId: created!.id,
          position: input.primary.position ?? null,
          isPrimary: true,
        });
        contactId = person.id;
      } else if (input.primary?.kind === 'new') {
        const [person] = await tx
          .insert(contacts)
          .values(contactColumns(input.primary.contact))
          .returning({ id: contacts.id });
        await tx.insert(contactLinks).values({
          contactId: person!.id,
          organizationId: created!.id,
          position: input.primary.contact.position ?? null,
          isPrimary: true,
        });
        contactId = person!.id;
      }
      await touch(tx, parent.id);
      return { id: created!.id, parentId: parent.id, contactId };
    }),
  );
}

/** A prevádzka's own fields; which of them changed, for the audit trail. */
export async function updateEstablishment(db: Db, id: string, input: EstablishmentInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, id), alive))
      .for('update');
    if (!current) throw new CustomerError('NOT_FOUND');
    if (!current.parentId) throw new CustomerError('NOT_ESTABLISHMENT');
    const values = establishmentColumns(input);
    const fields = changedFields(current, values);
    await tx
      .update(organizations)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(organizations.id, id));
    return { parentId: current.parentId, fields };
  });
}

/**
 * The persons of an organization and of all its prevádzky (docs/establishments.md 4.2): one row a
 * person, with their place at the organization (if any) and the prevádzky they are at.
 */
export async function organizationPersons(db: Db | Tx, organizationId: string) {
  const rows = await db
    .select({
      contact: contacts,
      organizationId: contactLinks.organizationId,
      organizationName: organizations.name,
      parentId: organizations.parentId,
      position: contactLinks.position,
      isPrimary: contactLinks.isPrimary,
    })
    .from(contactLinks)
    .innerJoin(contacts, eq(contacts.id, contactLinks.contactId))
    .innerJoin(organizations, eq(organizations.id, contactLinks.organizationId))
    .where(
      and(
        or(eq(organizations.id, organizationId), eq(organizations.parentId, organizationId)),
        alive,
        aliveContact,
      ),
    )
    .orderBy(collated(contacts.lastName), collated(contacts.firstName), asc(contacts.id));
  type Person = Omit<(typeof rows)[number]['contact'], 'deletedAt'> & {
    position: string | null;
    isPrimary: boolean;
    atOrganization: boolean;
    establishments: { id: string; name: string; position: string | null; isPrimary: boolean }[];
  };
  const byId = new Map<string, Person>();
  for (const row of rows) {
    const person =
      byId.get(row.contact.id) ??
      ({
        ...omit(row.contact, 'deletedAt'),
        position: null,
        isPrimary: false,
        atOrganization: false,
        establishments: [],
      } satisfies Person);
    if (row.organizationId !== organizationId) {
      person.establishments.push({
        id: row.organizationId,
        name: row.organizationName,
        position: row.position,
        isPrimary: row.isPrimary,
      });
      person.position ??= row.position;
    } else {
      person.atOrganization = true;
      person.isPrimary = row.isPrimary;
      person.position = row.position;
    }
    byId.set(row.contact.id, person);
  }
  // The organization's primary contact first, the rest by name.
  return [...byId.values()].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}
