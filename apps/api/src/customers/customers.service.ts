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
  contactLinks,
  contacts,
  contactTypes,
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
      | 'CONTACT_TYPE_UNKNOWN',
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

/** The status filter: one status, or the records without one. */
const statusWhere = (status: CustomerFilter['status']) =>
  status === 'none'
    ? [isNull(organizations.status)]
    : status
      ? [eq(organizations.status, status)]
      : [];

/** The filters of the list as a WHERE clause; `status` is left to the caller (the chips count without it). */
function filterWhere(filter: CustomerFilter): SQL[] {
  const where: SQL[] = [alive];
  if (filter.kind) where.push(eq(organizations.kind, filter.kind));
  if (filter.contactTypeId) where.push(eq(organizations.contactTypeId, filter.contactTypeId));
  if (filter.productId === 'none') {
    where.push(
      sql`not exists (select 1 from organization_products cp where cp.organization_id = ${CUSTOMER_ID})`,
    );
  } else if (filter.productId) {
    where.push(
      sql`exists (select 1 from organization_products cp where cp.organization_id = ${CUSTOMER_ID} and cp.product_id = ${filter.productId})`,
    );
  }
  if (filter.region) where.push(eq(organizations.region, filter.region));
  if (filter.ownerUserId) where.push(eq(organizations.ownerUserId, filter.ownerUserId));
  if (filter.tagId) {
    where.push(
      sql`exists (select 1 from organization_tags ct where ct.organization_id = ${CUSTOMER_ID} and ct.tag_id = ${filter.tagId})`,
    );
  }
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
        name: organizations.name,
        city: organizations.city,
        contactTypeName: contactTypes.name,
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
      .innerJoin(contactTypes, eq(contactTypes.id, organizations.contactTypeId))
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
  } | null>`(select json_build_object('id', u.id, 'name', u.name) from users u where u.id = "organizations"."owner_user_id")`;
  const createdBy = sql<
    string | null
  >`(select u.name from users u where u.id = "organizations"."created_by_user_id")`;
  const [row] = await db
    .select({
      customer: organizations,
      contactTypeName: contactTypes.name,
      products: productsJson,
      sourceName: organizationSources.name,
      owner,
      createdBy,
      tags: tagsJson,
    })
    .from(organizations)
    .innerJoin(contactTypes, eq(contactTypes.id, organizations.contactTypeId))
    .leftJoin(organizationSources, eq(organizationSources.id, organizations.sourceId))
    .where(and(eq(organizations.id, id), alive));
  if (!row) throw new CustomerError('NOT_FOUND');
  const people = await personsOf(db, id);
  const { customer, ...rest } = row;
  const self = customer.kind === 'individual' ? people.find((p) => p.isPrimary) : undefined;
  return {
    ...omit(customer, 'deletedAt'),
    ...rest,
    // A private person's own fields, from their person (stage O2 keeps the old shape).
    ...personFieldsOf(self),
    email: self ? self.email : customer.email,
    phone: self ? self.phone : customer.phone,
    contacts: customer.kind === 'individual' ? [] : people,
  };
}

/** The live persons of an organization with their position there, the primary one first. */
async function personsOf(db: Db | Tx, organizationId: string) {
  const rows = await db
    .select({
      contact: contacts,
      position: contactLinks.position,
      isPrimary: contactLinks.isPrimary,
    })
    .from(contactLinks)
    .innerJoin(contacts, eq(contacts.id, contactLinks.contactId))
    .where(and(eq(contactLinks.organizationId, organizationId), aliveContact))
    .orderBy(desc(contactLinks.isPrimary), asc(contacts.createdAt));
  return rows.map(({ contact, position, isPrimary }) => ({
    ...omit(contact, 'deletedAt'),
    position,
    isPrimary,
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
      const values = columnsOf(
        input.customer,
        await hasSalesStatus(tx, input.customer.contactTypeId),
      );
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
      const productChange = await setProducts(tx, created!.id, input.customer.productIds);
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
      if (current.kind !== input.kind) throw new CustomerError('KIND_CHANGED');
      await assertIcoFree(tx, input.kind === 'organization' ? input.ico : undefined, id);
      const values = columnsOf(input, await hasSalesStatus(tx, input.contactTypeId));
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
    .update(organizations)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(organizations.id, id), alive))
    .returning({ id: organizations.id });
  if (!row) throw new CustomerError('NOT_FOUND');
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
    .where(
      and(
        inArray(organizations.id, ids),
        alive,
        sql`${organizations.contactTypeId} in (select id from contact_types where system_key = 'customer')`,
      ),
    )
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
      contactType: contactTypes.name,
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
    .innerJoin(contactTypes, eq(contactTypes.id, organizations.contactTypeId))
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
        .select({ id: organizationSources.id, name: organizationSources.name })
        .from(organizationSources)
        .where(inArray(organizationSources.id, list)),
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
    contactTypes: contactTypeRows,
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
