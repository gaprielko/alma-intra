import {
  CUSTOMER_KINDS,
  type DiscountStep,
  ITEM_BILLINGS,
  PRODUCT_PERIODS,
  PRODUCT_PRICINGS,
  ORGANIZATION_ROLES,
  CUSTOMER_STATUSES,
  EMAIL_STATUSES,
  GENDERS,
  REGIONS,
} from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  jsonb,
  date,
  foreignKey,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const organizationKind = pgEnum('organization_kind', CUSTOMER_KINDS);
export const organizationRole = pgEnum('organization_role', ORGANIZATION_ROLES);
export const customerStatus = pgEnum('customer_status', CUSTOMER_STATUSES);
export const region = pgEnum('region', REGIONS);
export const gender = pgEnum('gender', GENDERS);
export const emailStatus = pgEnum('email_status', EMAIL_STATUSES);
/** How a person stopped the marketing e-mails: a colleague switched them off, or the link. */
export const unsubscribeSource = pgEnum('unsubscribe_source', ['manual', 'link']);

/**
 * A code list of Settings › Číselníky: a name, an order and whether new organizations are offered it.
 * An item somebody uses is never deleted, only switched off.
 */
export const codeListColumns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productPeriod = pgEnum('product_period', PRODUCT_PERIODS);
export const itemBilling = pgEnum('item_billing', ITEM_BILLINGS);

/** EUR to the cent, read as a number. */
const money = (name: string) => numeric(name, { precision: 10, scale: 2, mode: 'number' });

/**
 * What a customer buys (docs/products.md): ADOS, DOS, … with its base price for a period and its
 * price list. `active` is „Ponúka sa“; off, it is kept for the customers who have it.
 */
export const products = pgTable(
  'products',
  {
    ...codeListColumns(),
    description: text('description'),
    /** Without and with VAT, both kept so what was typed stays exact (R-9); NULL: not set yet. */
    basePrice: money('base_price'),
    basePriceGross: money('base_price_gross'),
    period: productPeriod('period').notNull().default('month'),
    /** Every workload is rounded up to this many percent (R-14). */
    workloadStep: integer('workload_step').notNull().default(50),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('products_name_unique').on(sql`lower(${t.name})`),
    check('products_workload_step', sql`${t.workloadStep} between 1 and 100`),
  ],
);

/** The shared catalog of what price lists count or add (R-2): „Admin prístup“, „Sestra“, … */
export const productItems = pgTable(
  'product_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** The word for one („prístup“, „sestra“). */
    unit: text('unit'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('product_items_name_unique').on(sql`lower(${t.name})`)],
);

/** One product's price list (R-3): an item with this product's numbers. */
export const productPriceItems = pgTable(
  'product_price_items',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => productItems.id),
    included: integer('included').notNull().default(0),
    unitPrice: money('unit_price'),
    unitPriceGross: money('unit_price_gross'),
    max: integer('max'),
    billing: itemBilling('billing').notNull().default('recurring'),
    byWorkload: boolean('by_workload').notNull().default(false),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.itemId] }),
    index('product_price_items_item_idx').on(t.itemId),
  ],
);

/** Nastavenia › Ceny a DPH: one row (R-9). */
export const pricingSettings = pgTable('pricing_settings', {
  id: integer('id').primaryKey().default(1),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2, mode: 'number' }).notNull().default(23),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Where a customer came from: a referral, a conference, the web. */
export const organizationSources = pgTable('organization_sources', codeListColumns(), (t) => [
  uniqueIndex('organization_sources_name_unique').on(sql`lower(${t.name})`),
]);

/** Free tags for segmentation („pilot 2027“); made where a customer gets one. */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_name_unique').on(sql`lower(${t.name})`)],
);

/**
 * A customer: an organization with contact persons, or a private person who is their own contact
 * (the person's fields then live here, so the e-mail flow treats both alike). `name` is the
 * company's name, or the person's name built from its parts. Soft deleted: the communication
 * history keeps pointing at it.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: organizationKind('kind').notNull(),
    /** Customer or partner (D-1): a partner has no status, owner or products. */
    role: organizationRole('role').notNull(),
    name: text('name').notNull(),
    ico: text('ico'),
    dic: text('dic'),
    icDph: text('ic_dph'),
    /** The sales pipeline: a „Zákazník“ only, empty until somebody sets it; null for any other type. */
    status: customerStatus('status'),
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    region: region('region'),
    web: text('web'),
    email: text('email'),
    phone: text('phone'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    sourceId: uuid('source_id').references(() => organizationSources.id),
    note: text('note'),
    almaOrganizationId: text('alma_organization_id'),
    /**
     * „Ceny produktov“: how prices are shown to this organization, with or without VAT. Set on the
     * organization and valid for its prevádzky too; a private person always gets prices with VAT.
     */
    pricesWithVat: boolean('prices_with_vat').notNull().default(true),
    /**
     * A prevádzka's organization (docs/establishments.md): NULL for an organization. One level
     * only; a prevádzka shares its organization's IČO, role, status, owner, source and tags.
     */
    parentId: uuid('parent_id').references((): AnyPgColumn => organizations.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // IČO is unique among the organizations in the list; a deleted one does not block a new one.
    uniqueIndex('organizations_ico_unique')
      .on(t.ico)
      .where(sql`${t.deletedAt} is null`),
    index('organizations_role_idx').on(t.role),
    index('organizations_status_idx').on(t.status),
    index('organizations_owner_idx').on(t.ownerUserId),
    index('organizations_parent_idx').on(t.parentId),
    check('organizations_parent_not_self', sql`${t.parentId} <> ${t.id}`),
    check('organizations_name_length', sql`char_length(${t.name}) between 1 and 200`),
  ],
);

export const organizationTags = pgTable(
  'organization_tags',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.tagId] }),
    index('organization_tags_tag_idx').on(t.tagId),
  ],
);

export const productPricing = pgEnum('product_pricing', PRODUCT_PRICINGS);

/**
 * A product an organization or a prevádzka holds (docs/products.md 9): once at a time, with its
 * dates and how it is priced; its counts and workloads in the two tables below.
 */
export const organizationProducts = pgTable(
  'organization_products',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    validFrom: date('valid_from')
      .notNull()
      .default(sql`current_date`),
    /** NULL: ongoing; ending sets it, nothing is deleted (R-10). */
    validTo: date('valid_to'),
    pricing: productPricing('pricing').notNull().default('list'),
    /** The stretches of the discount, one after another from `valid_from` (R-19). */
    discountSteps: jsonb('discount_steps').$type<DiscountStep[]>().notNull().default([]),
    fixedPrice: money('fixed_price'),
    fixedPriceGross: money('fixed_price_gross'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.productId] }),
    index('organization_products_product_idx').on(t.productId),
  ],
);

/** How many of each item of the price list a holder has (R-13). */
export const organizationProductCounts = pgTable(
  'organization_product_counts',
  {
    organizationId: uuid('organization_id').notNull(),
    productId: uuid('product_id').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => productItems.id),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.productId, t.itemId] }),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [organizationProducts.organizationId, organizationProducts.productId],
      name: 'organization_product_counts_holding_fk',
    }).onDelete('cascade'),
  ],
);

/** The people and their workload behind an item counted by workloads (R-14). */
export const organizationProductWorkloads = pgTable(
  'organization_product_workloads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    productId: uuid('product_id').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => productItems.id),
    persons: integer('persons').notNull(),
    percent: integer('percent').notNull(),
  },
  (t) => [
    index('organization_product_workloads_holding_idx').on(t.organizationId, t.productId),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [organizationProducts.organizationId, organizationProducts.productId],
      name: 'organization_product_workloads_holding_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * A natural person (Kontakty): a contact person of customers or partners, a private-person
 * customer or partner itself, or nobody's (D-2). Where they work is `contact_links`. Soft deleted.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    titleBefore: text('title_before'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    titleAfter: text('title_after'),
    gender: gender('gender'),
    salutation: text('salutation'),
    email: text('email'),
    phone: text('phone'),
    emailStatus: emailStatus('email_status').notNull().default('ok'),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    unsubscribeSource: unsubscribeSource('unsubscribe_source'),
    note: text('note'),
    /** Made from this user: the titles, name, e-mail and phone follow theirs (D-47). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // A user is one live contact.
    uniqueIndex('contacts_user_unique')
      .on(t.userId)
      .where(sql`${t.deletedAt} is null and ${t.userId} is not null`),
    // One person is entered once (D-7): an e-mail belongs to one live person.
    uniqueIndex('contacts_email_unique')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.deletedAt} is null and ${t.email} is not null`),
  ],
);

/**
 * A person at an organization (D-3): their position there and whether they are its primary
 * contact, the default recipient. A person may have none (D-2) or several. A private-person
 * customer or partner is linked to its own person as the primary contact.
 */
export const contactLinks = pgTable(
  'contact_links',
  {
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    position: text('position'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.organizationId] }),
    index('contact_links_organization_idx').on(t.organizationId),
    uniqueIndex('contact_links_primary_unique')
      .on(t.organizationId)
      .where(sql`${t.isPrimary}`),
  ],
);
