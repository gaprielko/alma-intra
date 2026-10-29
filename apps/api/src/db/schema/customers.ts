import {
  CUSTOMER_KINDS,
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
  integer,
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

/** What Alma offers a record (ADOS, DOS, Stacionár, …): none, one or several. */
export const products = pgTable('products', codeListColumns(), (t) => [
  uniqueIndex('products_name_unique').on(sql`lower(${t.name})`),
]);

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

export const organizationProducts = pgTable(
  'organization_products',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.productId] }),
    index('organization_products_product_idx').on(t.productId),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
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
