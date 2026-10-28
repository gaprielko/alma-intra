import { sk } from '@intra/shared/i18n';
import {
  type CustomField,
  type EmailLook,
  type EmailNode,
  personName,
  type TemplateValues,
} from '@intra/shared/schemas';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/db.module.js';
import {
  contacts,
  customers,
  emailLook,
  emailTemplateAttachments,
  emailTemplates,
  files,
  fileVersions,
  templateCategories,
  users,
} from '../db/schema/index.js';
import { plainOf, renderEmail, type Values } from './render.js';

export class TemplateError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CATEGORY_NOT_FOUND' | 'FILE_NOT_FOUND') {
    super(code);
  }
}

const editor = alias(users, 'editor');
const labelsOf = (fields: CustomField[]) =>
  Object.fromEntries(fields.map((field) => [field.key, field.label]));

/** The list of Šablóny with the chips' counts; the subject as plain text with variable names. */
export async function listTemplates(
  db: Db,
  /** `categoryId`: a category's id, or `inactive` for the switched-off templates. */
  filter: { categoryId?: string | undefined; search?: string | undefined },
) {
  const where = [];
  if (filter.categoryId === 'inactive') where.push(eq(emailTemplates.active, false));
  else {
    where.push(eq(emailTemplates.active, true));
    if (filter.categoryId) where.push(eq(emailTemplates.categoryId, filter.categoryId));
  }
  if (filter.search) {
    where.push(
      sql`${emailTemplates.name} ilike ${`%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`,
    );
  }
  const [rows, counts, categories] = await Promise.all([
    db
      .select({
        id: emailTemplates.id,
        name: emailTemplates.name,
        subject: emailTemplates.subject,
        customFields: emailTemplates.customFields,
        active: emailTemplates.active,
        categoryId: emailTemplates.categoryId,
        categoryName: templateCategories.name,
        updatedAt: emailTemplates.updatedAt,
        updatedBy: editor.name,
      })
      .from(emailTemplates)
      .leftJoin(templateCategories, eq(templateCategories.id, emailTemplates.categoryId))
      .leftJoin(editor, eq(editor.id, emailTemplates.updatedByUserId))
      .where(and(...where))
      .orderBy(desc(emailTemplates.updatedAt)),
    db
      .select({
        categoryId: emailTemplates.categoryId,
        active: emailTemplates.active,
        count: sql<number>`count(*)::int`,
      })
      .from(emailTemplates)
      .groupBy(emailTemplates.categoryId, emailTemplates.active),
    db
      .select({
        id: templateCategories.id,
        name: templateCategories.name,
        active: templateCategories.active,
      })
      .from(templateCategories)
      .orderBy(asc(templateCategories.position)),
  ]);
  const active = counts.filter((c) => c.active);
  return {
    items: rows.map(({ subject, customFields, ...row }) => ({
      ...row,
      subject: plainOf(subject, {}, labelsOf(customFields)),
    })),
    counts: {
      all: active.reduce((sum, c) => sum + c.count, 0),
      inactive: counts.filter((c) => !c.active).reduce((sum, c) => sum + c.count, 0),
      byCategory: Object.fromEntries(
        active.filter((c) => c.categoryId).map((c) => [c.categoryId!, c.count]),
      ) as Record<string, number>,
    },
    categories,
  };
}

/** The editor's template, with its attachments' names and who saved it last. */
export async function getTemplate(db: Db, id: string) {
  const [row] = await db
    .select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      categoryId: emailTemplates.categoryId,
      language: emailTemplates.language,
      subject: emailTemplates.subject,
      body: emailTemplates.body,
      customFields: emailTemplates.customFields,
      active: emailTemplates.active,
      updatedAt: emailTemplates.updatedAt,
      updatedBy: editor.name,
    })
    .from(emailTemplates)
    .leftJoin(editor, eq(editor.id, emailTemplates.updatedByUserId))
    .where(eq(emailTemplates.id, id));
  if (!row) throw new TemplateError('NOT_FOUND');
  const attachments = await db
    .select({
      fileId: files.id,
      name: files.name,
      size: fileVersions.size,
      trashed: sql<boolean>`${files.deletedAt} is not null`,
    })
    .from(emailTemplateAttachments)
    .innerJoin(files, eq(files.id, emailTemplateAttachments.fileId))
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(eq(emailTemplateAttachments.templateId, id))
    .orderBy(asc(emailTemplateAttachments.position));
  return { ...row, attachments };
}

async function checkRefs(tx: Tx, input: TemplateValues) {
  if (input.categoryId) {
    const [category] = await tx
      .select({ id: templateCategories.id })
      .from(templateCategories)
      .where(eq(templateCategories.id, input.categoryId));
    if (!category) throw new TemplateError('CATEGORY_NOT_FOUND');
  }
  const fileIds = [...new Set(input.attachmentFileIds)];
  if (fileIds.length > 0) {
    const found = await tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(inArray(files.id, fileIds), isNull(files.deletedAt), isNotNull(files.currentVersionId)),
      );
    if (found.length !== fileIds.length) throw new TemplateError('FILE_NOT_FOUND');
  }
  return fileIds;
}

async function writeAttachments(tx: Tx, templateId: string, fileIds: string[]) {
  await tx
    .delete(emailTemplateAttachments)
    .where(eq(emailTemplateAttachments.templateId, templateId));
  if (fileIds.length > 0) {
    await tx
      .insert(emailTemplateAttachments)
      .values(fileIds.map((fileId, position) => ({ templateId, fileId, position })));
  }
}

const columnsOf = (input: TemplateValues) => ({
  name: input.name,
  categoryId: input.categoryId,
  language: input.language,
  subject: input.subject,
  body: input.body,
  customFields: input.customFields,
  active: input.active,
});

export async function createTemplate(db: Db, userId: string, input: TemplateValues) {
  return db.transaction(async (tx) => {
    const fileIds = await checkRefs(tx, input);
    const [created] = await tx
      .insert(emailTemplates)
      .values({ ...columnsOf(input), createdByUserId: userId, updatedByUserId: userId })
      .returning({ id: emailTemplates.id });
    await writeAttachments(tx, created!.id, fileIds);
    return { id: created!.id };
  });
}

export async function updateTemplate(db: Db, userId: string, id: string, input: TemplateValues) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, id))
      .for('update');
    if (!current) throw new TemplateError('NOT_FOUND');
    const fileIds = await checkRefs(tx, input);
    const values = columnsOf(input);
    const fields = (Object.keys(values) as (keyof typeof values)[])
      .filter((key) => JSON.stringify(current[key]) !== JSON.stringify(values[key]))
      .sort();
    await tx
      .update(emailTemplates)
      .set({ ...values, updatedByUserId: userId, updatedAt: new Date() })
      .where(eq(emailTemplates.id, id));
    await writeAttachments(tx, id, fileIds);
    return { fields, active: values.active };
  });
}

/** „Duplikovať“: a copy named so, the attachments with it. */
export async function duplicateTemplate(db: Db, userId: string, id: string) {
  const source = await getTemplate(db, id);
  return createTemplate(db, userId, {
    name: sk.templates.copyName(source.name).slice(0, 120),
    categoryId: source.categoryId,
    language: 'sk',
    subject: source.subject,
    body: source.body,
    customFields: source.customFields,
    attachmentFileIds: source.attachments.filter((a) => !a.trashed).map((a) => a.fileId),
    active: source.active,
  });
}

export async function getLook(db: Db | Tx): Promise<EmailLook> {
  const [row] = await db.select().from(emailLook).where(eq(emailLook.id, 1));
  return {
    logoKey: row?.logoKey ?? null,
    headerStyle: row?.headerStyle ?? 'dark',
    brandName: row?.brandName ?? 'Alma',
    headerText: row?.headerText ?? '',
    accent: (row?.accent ?? '#0f766e') as EmailLook['accent'],
    footerCompany: row?.footerCompany ?? '',
    footerIco: row?.footerIco ?? '',
    footerWeb: row?.footerWeb ?? '',
    footerEmail: row?.footerEmail ?? '',
  };
}

export async function updateLook(db: Db, userId: string, look: EmailLook) {
  const before = await getLook(db);
  const fields = (Object.keys(look) as (keyof EmailLook)[])
    .filter((key) => before[key] !== look[key])
    .sort();
  await db
    .insert(emailLook)
    .values({ id: 1, ...look, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: emailLook.id,
      set: { ...look, updatedByUserId: userId, updatedAt: new Date() },
    });
  return { fields };
}

/** The contacts a preview can be filled for: primary contacts and private persons. */
export async function previewContacts(db: Db) {
  const rows = await db
    .select({
      id: contacts.id,
      titleBefore: contacts.titleBefore,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      titleAfter: contacts.titleAfter,
      customerName: customers.name,
    })
    .from(contacts)
    .innerJoin(customers, eq(customers.id, contacts.customerId))
    .where(
      and(isNull(contacts.deletedAt), isNull(customers.deletedAt), eq(contacts.isPrimary, true)),
    )
    .orderBy(sql`${customers.name} collate "sk-x-icu"`)
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    name: personName(row),
    customerName: row.customerName,
  }));
}

/**
 * The values of the variables for one contact and one sender. A value that is empty stays
 * missing: the preview marks it, sending refuses it.
 */
export async function valuesFor(
  db: Db | Tx,
  /** A contact; or, for a private person, the customer alone (no `contactId`). */
  recipient: { contactId?: string | undefined; customerId?: string | undefined },
  senderUserId: string,
  custom: Readonly<Record<string, string>>,
): Promise<{ values: Values; customerName: string | undefined }> {
  const values: Record<string, string | undefined> = {};
  let customerName: string | undefined;
  const contactId = recipient.contactId;
  if (!contactId && recipient.customerId) {
    const [row] = await db
      .select({
        titleBefore: customers.titleBefore,
        firstName: customers.firstName,
        lastName: customers.lastName,
        titleAfter: customers.titleAfter,
        salutation: customers.salutation,
        name: customers.name,
        city: customers.city,
      })
      .from(customers)
      .where(eq(customers.id, recipient.customerId));
    if (row) {
      values.salutation = row.salutation ?? undefined;
      values['contact.firstName'] = row.firstName ?? undefined;
      values['contact.lastName'] = row.lastName ?? undefined;
      values['contact.fullName'] = row.name;
      values['customer.name'] = row.name;
      values['customer.city'] = row.city ?? undefined;
      customerName = row.name;
    }
  }
  if (contactId) {
    const [row] = await db
      .select({
        titleBefore: contacts.titleBefore,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        titleAfter: contacts.titleAfter,
        salutation: contacts.salutation,
        position: contacts.position,
        customerName: customers.name,
        city: customers.city,
      })
      .from(contacts)
      .innerJoin(customers, eq(customers.id, contacts.customerId))
      .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)));
    if (row) {
      values.salutation = row.salutation ?? undefined;
      values['contact.firstName'] = row.firstName;
      values['contact.lastName'] = row.lastName;
      values['contact.fullName'] = personName(row);
      values['contact.position'] = row.position ?? undefined;
      values['customer.name'] = row.customerName;
      values['customer.city'] = row.city ?? undefined;
      customerName = row.customerName;
    }
  }
  const [sender] = await db
    .select({ name: users.name, phone: users.phone, position: users.position })
    .from(users)
    .where(eq(users.id, senderUserId));
  values['sender.name'] = sender?.name;
  values['sender.phone'] = sender?.phone ?? undefined;
  values['sender.position'] = sender?.position ?? undefined;
  for (const [key, value] of Object.entries(custom)) {
    values[`custom.${key}`] = value.trim() || undefined;
  }
  return { values, customerName };
}

/** The e-mail exactly as a recipient would get it, for the editor's preview. */
export async function previewTemplate(
  db: Db,
  baseUrl: string,
  senderUserId: string,
  input: {
    subject: EmailNode;
    body: EmailNode;
    customFields: CustomField[];
    contactId?: string | undefined;
    values: Readonly<Record<string, string>>;
  },
) {
  const [look, filled] = await Promise.all([
    getLook(db),
    valuesFor(db, { contactId: input.contactId }, senderUserId, input.values),
  ]);
  const rendered = await renderEmail({
    look,
    baseUrl,
    subject: input.subject,
    body: input.body,
    values: filled.values,
    labels: labelsOf(input.customFields),
    signature: true,
    customerName: filled.customerName ?? sk.templates.variables['customer.name'],
    unsubscribeUrl: `${baseUrl}/odhlasenie`,
  });
  return {
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    missing: rendered.missing,
  };
}

/**
 * „Poslať test“ from the template editor: the preview as it stands (saved or not), marked TEST, to
 * the signed-in user's own address. No attachments.
 */
export async function testTemplate(
  db: Db,
  env: { WEB_URL: string; CAMPAIGN_FROM_ADDRESS: string },
  userId: string,
  input: Parameters<typeof previewTemplate>[3],
) {
  const [[user], look, out] = await Promise.all([
    db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)),
    getLook(db),
    previewTemplate(db, env.WEB_URL, userId, input),
  ]);
  return {
    to: user!.email,
    from: `${user!.name} | ${look.brandName} <${env.CAMPAIGN_FROM_ADDRESS}>`,
    subject: `${sk.campaigns.review.testPrefix} ${out.subject}`,
    html: out.html,
    text: out.text,
  };
}

/** The look alone, with a sample body: Settings › Vzhľad e-mailov. */
export async function previewLook(db: Db, baseUrl: string, senderUserId: string, look: EmailLook) {
  const filled = await valuesFor(db, {}, senderUserId, {});
  const body: EmailNode = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Vážená pani riaditeľka,' }] },
      { type: 'paragraph', content: [{ type: 'text', text: sk.emailLook.sampleBody }] },
      {
        type: 'button',
        attrs: { text: sk.templates.editor.buttonDefault, href: 'https://alma-care.eu' },
      },
    ],
  };
  const rendered = await renderEmail({
    look,
    baseUrl,
    subject: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: look.brandName }] }],
    },
    body,
    values: filled.values,
    labels: {},
    signature: true,
    customerName: sk.templates.variables['customer.name'],
    unsubscribeUrl: `${baseUrl}/odhlasenie`,
  });
  return { html: rendered.html };
}
