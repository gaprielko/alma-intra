import type { CustomField, EmailNode } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { codeListColumns, products } from './customers.js';
import { files } from './files.js';
import { users } from './users.js';

/** Offer, news, invitation, follow-up: Settings › Číselníky. */
export const templateCategories = pgTable('template_categories', codeListColumns(), (t) => [
  uniqueIndex('template_categories_name_unique').on(sql`lower(${t.name})`),
]);

/**
 * An e-mail template: a subject and a body (TipTap documents with variables), the custom fields
 * filled at sending, and default attachments. Never deleted: switched off (`active`).
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    categoryId: uuid('category_id').references(() => templateCategories.id),
    /** Whose look its e-mails wear; NULL: the global one (D-39). */
    lookProductId: uuid('look_product_id').references(() => products.id, { onDelete: 'set null' }),
    /** Of which type of e-mail (D-57). */
    lookKind: text('look_kind', { enum: ['personal', 'team'] })
      .notNull()
      .default('personal'),
    language: text('language').notNull().default('sk'),
    subject: jsonb('subject').$type<EmailNode>().notNull(),
    body: jsonb('body').$type<EmailNode>().notNull(),
    customFields: jsonb('custom_fields').$type<CustomField[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('email_templates_category_idx').on(t.categoryId),
    check('email_templates_name_length', sql`char_length(${t.name}) between 1 and 120`),
  ],
);

/** A file offered as an attachment when the template is used; its version is taken at sending. */
export const emailTemplateAttachments = pgTable(
  'email_template_attachments',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => emailTemplates.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.fileId] })],
);

/**
 * An image for e-mails (the logo, pictures in a body). E-mail clients cannot use links that
 * expire, so an image is served at `/m/<key>` by the API, which answers with a fresh signed link.
 * The key is random and unguessable; only images inserted into e-mails are here, never other
 * files. `confirmedAt` is set once the upload was checked.
 */
export const emailImages = pgTable('email_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
});

/**
 * The looks of e-mails (D-57): per type of e-mail, the global one (no product) and a product's own
 * over it (D-39), used only when `enabled`. A NULL signature or footer has not been written yet: a
 * product's takes the global one's, a global one's the default of its type.
 */
export const emailLooks = pgTable(
  'email_looks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['personal', 'team'] }).notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    logoKey: text('logo_key'),
    headerStyle: text('header_style', { enum: ['dark', 'light'] })
      .notNull()
      .default('dark'),
    brandName: text('brand_name').notNull().default('Alma'),
    headerDoc: jsonb('header_doc').$type<EmailNode>(),
    senderNameDoc: jsonb('sender_name_doc').$type<EmailNode>(),
    signatureDoc: jsonb('signature_doc').$type<EmailNode>(),
    footerDoc: jsonb('footer_doc').$type<EmailNode>(),
    accent: text('accent').notNull().default('#0f766e'),
    footerWeb: text('footer_web').notNull().default(''),
    footerEmail: text('footer_email').notNull().default(''),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('email_looks_kind_product_unique').on(t.kind, t.productId).nullsNotDistinct()],
);

/** Settings › Firma: one row. */
export const companySettings = pgTable(
  'company_settings',
  {
    id: integer('id').primaryKey().default(1),
    name: text('name').notNull().default(''),
    ico: text('ico').notNull().default(''),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('company_settings_single_row', sql`${t.id} = 1`)],
);

/** „Spoločné nastavenia e-mailov“: one row, the same for every look. */
export const emailSettings = pgTable(
  'email_settings',
  {
    id: integer('id').primaryKey().default(1),
    replyMode: text('reply_mode', { enum: ['intra', 'company', 'sender'] })
      .notNull()
      .default('company'),
    replyToAddress: text('reply_to_address').notNull().default('info@alma-care.eu'),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('email_settings_single_row', sql`${t.id} = 1`)],
);
