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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { codeListColumns } from './customers.js';
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

/** Settings › Vzhľad e-mailov: one row, the company look every e-mail wears. */
export const emailLook = pgTable(
  'email_look',
  {
    id: integer('id').primaryKey().default(1),
    logoKey: text('logo_key'),
    headerStyle: text('header_style', { enum: ['dark', 'light'] })
      .notNull()
      .default('dark'),
    brandName: text('brand_name').notNull().default('Alma'),
    headerText: text('header_text').notNull().default(''),
    accent: text('accent').notNull().default('#0f766e'),
    footerCompany: text('footer_company').notNull().default(''),
    footerIco: text('footer_ico').notNull().default(''),
    footerWeb: text('footer_web').notNull().default(''),
    footerEmail: text('footer_email').notNull().default(''),
    replyMode: text('reply_mode', { enum: ['intra', 'company', 'sender'] })
      .notNull()
      .default('company'),
    replyToAddress: text('reply_to_address').notNull().default('info@alma-care.eu'),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('email_look_single_row', sql`${t.id} = 1`)],
);
