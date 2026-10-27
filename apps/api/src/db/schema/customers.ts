import {
  CUSTOMER_KINDS,
  CUSTOMER_STATUSES,
  EMAIL_STATUSES,
  GENDERS,
  REGIONS,
} from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
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

export const customerKind = pgEnum('customer_kind', CUSTOMER_KINDS);
export const customerStatus = pgEnum('customer_status', CUSTOMER_STATUSES);
export const region = pgEnum('region', REGIONS);
export const gender = pgEnum('gender', GENDERS);
export const emailStatus = pgEnum('email_status', EMAIL_STATUSES);
/** How a person stopped the marketing e-mails: a colleague switched them off, or the link. */
export const unsubscribeSource = pgEnum('unsubscribe_source', ['manual', 'link']);

/**
 * A code list of Settings › Číselníky: a name, an order and whether new customers are offered it.
 * An item somebody uses is never deleted, only switched off.
 */
const codeListColumns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** ADOS, a social care home, …: optional, independent of the kind. */
export const customerTypes = pgTable('customer_types', codeListColumns(), (t) => [
  uniqueIndex('customer_types_name_unique').on(sql`lower(${t.name})`),
]);

/** Where a customer came from: a referral, a conference, the web. */
export const customerSources = pgTable('customer_sources', codeListColumns(), (t) => [
  uniqueIndex('customer_sources_name_unique').on(sql`lower(${t.name})`),
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
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: customerKind('kind').notNull(),
    typeId: uuid('type_id').references(() => customerTypes.id),
    name: text('name').notNull(),
    ico: text('ico'),
    dic: text('dic'),
    icDph: text('ic_dph'),
    status: customerStatus('status').notNull().default('lead'),
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    region: region('region'),
    web: text('web'),
    email: text('email'),
    phone: text('phone'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    sourceId: uuid('source_id').references(() => customerSources.id),
    note: text('note'),
    almaOrganizationId: text('alma_organization_id'),
    // A private person only.
    titleBefore: text('title_before'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    titleAfter: text('title_after'),
    gender: gender('gender'),
    salutation: text('salutation'),
    emailStatus: emailStatus('email_status').notNull().default('ok'),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    unsubscribeSource: unsubscribeSource('unsubscribe_source'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // IČO is unique among the customers in the list; a deleted one does not block a new one.
    uniqueIndex('customers_ico_unique')
      .on(t.ico)
      .where(sql`${t.deletedAt} is null`),
    index('customers_status_idx').on(t.status),
    index('customers_type_idx').on(t.typeId),
    index('customers_owner_idx').on(t.ownerUserId),
    check('customers_name_length', sql`char_length(${t.name}) between 1 and 200`),
    check(
      'customers_person_named',
      sql`${t.kind} = 'organization' or (${t.firstName} is not null and ${t.lastName} is not null)`,
    ),
  ],
);

export const customerTags = pgTable(
  'customer_tags',
  {
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.customerId, t.tagId] }),
    index('customer_tags_tag_idx').on(t.tagId),
  ],
);

/**
 * A person at an organization customer. One primary contact per customer, the default recipient;
 * an e-mail address once per customer. Soft deleted, like the customer.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    titleBefore: text('title_before'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    titleAfter: text('title_after'),
    gender: gender('gender'),
    salutation: text('salutation'),
    position: text('position'),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
    emailStatus: emailStatus('email_status').notNull().default('ok'),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    unsubscribeSource: unsubscribeSource('unsubscribe_source'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('contacts_customer_idx').on(t.customerId),
    uniqueIndex('contacts_primary_unique')
      .on(t.customerId)
      .where(sql`${t.isPrimary} and ${t.deletedAt} is null`),
    uniqueIndex('contacts_email_unique')
      .on(t.customerId, sql`lower(${t.email})`)
      .where(sql`${t.deletedAt} is null and ${t.email} is not null`),
  ],
);
