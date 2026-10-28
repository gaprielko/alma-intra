import { sk } from '@intra/shared/i18n';
import {
  MAX_SCHEDULE_DAYS,
  type CustomField,
  type EmailNode,
  MAX_MESSAGE_BYTES,
  personName,
  type SkipReason,
} from '@intra/shared/schemas';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { createHash, createHmac } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { Db, Tx } from '../db/db.module.js';
import {
  campaignAttachments,
  campaignMessages,
  campaigns,
  contacts,
  customers,
  emailTemplateAttachments,
  emailTemplates,
  files,
  fileVersions,
  messageAttachments,
  users,
} from '../db/schema/index.js';
import { missingOf, plainOf, renderEmail } from '../email/render.js';
import { getLook, valuesFor } from '../email/templates.service.js';

export class CampaignError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'NOT_DRAFT'
      | 'CUSTOMER_NOT_FOUND'
      | 'CONTACT_NOT_OF_CUSTOMER'
      | 'TEMPLATE_NOT_FOUND'
      | 'FILE_NOT_FOUND'
      | 'NO_RECIPIENTS'
      | 'NO_CONTENT'
      | 'MISSING_VALUES'
      | 'TOO_LARGE'
      | 'STORAGE_NOT_CONFIGURED'
      | 'BAD_SCHEDULE'
      | 'NOT_SCHEDULED',
    readonly count?: number,
  ) {
    super(code);
  }
}

const paragraph = (content: EmailNode[] = []): EmailNode => ({ type: 'paragraph', content });
const EMPTY_SUBJECT: EmailNode = { type: 'doc', content: [paragraph()] };
const EMPTY_BODY: EmailNode = {
  type: 'doc',
  content: [
    paragraph([
      { type: 'variable', attrs: { name: 'salutation' } },
      { type: 'text', text: ',' },
    ]),
    paragraph(),
  ],
};
const labelsOf = (fields: CustomField[]) =>
  Object.fromEntries(fields.map((field) => [field.key, field.label]));

async function draft(tx: Db | Tx, id: string, lock = false) {
  const query = tx.select().from(campaigns).where(eq(campaigns.id, id));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new CampaignError('NOT_FOUND');
  if (row.status !== 'draft') throw new CampaignError('NOT_DRAFT');
  return row;
}

const touch = (tx: Db | Tx, id: string) =>
  tx.update(campaigns).set({ updatedAt: new Date() }).where(eq(campaigns.id, id));

// ---------------------------------------------------------------------------------------------
// Recipients

/** Why a recipient would be left out today, or `null` when an e-mail can go to them. */
export function skipReasonOf(person: {
  email: string | null;
  unsubscribedAt: Date | null;
  emailStatus: string;
}): SkipReason | null {
  if (!person.email) return 'no_email';
  if (person.unsubscribedAt) return 'unsubscribed';
  if (person.emailStatus !== 'ok') return 'bounced';
  return null;
}

/**
 * The customers of the recipients step: each with the contacts an e-mail could go to, the primary
 * first, and why one would be left out. A private person is their own recipient.
 */
export async function recipientCandidates(db: Db | Tx, customerIds: string[]) {
  if (customerIds.length === 0) return [];
  const [rows, people] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        kind: customers.kind,
        city: customers.city,
        status: customers.status,
        email: customers.email,
        unsubscribedAt: customers.unsubscribedAt,
        emailStatus: customers.emailStatus,
      })
      .from(customers)
      .where(and(inArray(customers.id, customerIds), isNull(customers.deletedAt))),
    db
      .select({
        id: contacts.id,
        customerId: contacts.customerId,
        titleBefore: contacts.titleBefore,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        titleAfter: contacts.titleAfter,
        email: contacts.email,
        isPrimary: contacts.isPrimary,
        unsubscribedAt: contacts.unsubscribedAt,
        emailStatus: contacts.emailStatus,
      })
      .from(contacts)
      .where(and(inArray(contacts.customerId, customerIds), isNull(contacts.deletedAt)))
      .orderBy(desc(contacts.isPrimary), asc(contacts.lastName)),
  ]);
  const order = new Map(customerIds.map((id, i) => [id, i]));
  return rows
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((customer) => ({
      id: customer.id,
      name: customer.name,
      kind: customer.kind,
      city: customer.city,
      status: customer.status,
      /** A private person: their own address and state. */
      self:
        customer.kind === 'individual'
          ? { email: customer.email, skipReason: skipReasonOf(customer) }
          : null,
      contacts: people
        .filter((p) => p.customerId === customer.id)
        .map((p) => ({
          id: p.id,
          name: personName(p),
          email: p.email,
          isPrimary: p.isPrimary,
          skipReason: skipReasonOf(p),
        })),
    }));
}

/** The default recipients of a customer: a private person, or the primary contact. */
function defaultRecipients(
  candidates: Awaited<ReturnType<typeof recipientCandidates>>,
): { customerId: string; contactId: string | null }[] {
  return candidates.flatMap((customer): { customerId: string; contactId: string | null }[] => {
    if (customer.self) return [{ customerId: customer.id, contactId: null }];
    const primary = customer.contacts.find((c) => c.isPrimary) ?? customer.contacts[0];
    return primary ? [{ customerId: customer.id, contactId: primary.id }] : [];
  });
}

export async function createCampaign(
  db: Db,
  userId: string,
  customerIds: string[],
  fileIds: string[] = [],
) {
  return db.transaction(async (tx) => {
    await liveFiles(tx, fileIds);
    const [created] = await tx
      .insert(campaigns)
      .values({
        senderUserId: userId,
        subject: EMPTY_SUBJECT,
        body: EMPTY_BODY,
      })
      .returning({ id: campaigns.id });
    const candidates = await recipientCandidates(tx, [...new Set(customerIds)]);
    await writeRecipients(tx, created!.id, defaultRecipients(candidates));
    await writeCommonAttachments(tx, created!.id, fileIds);
    return { id: created!.id };
  });
}

async function writeRecipients(
  tx: Tx,
  campaignId: string,
  recipients: { customerId: string; contactId: string | null }[],
) {
  const unique = recipients.filter(
    (r, i) =>
      recipients.findIndex((o) => o.customerId === r.customerId && o.contactId === r.contactId) ===
      i,
  );
  const candidates = await recipientCandidates(tx, [...new Set(unique.map((r) => r.customerId))]);
  for (const r of unique) {
    const customer = candidates.find((c) => c.id === r.customerId);
    if (!customer) throw new CampaignError('CUSTOMER_NOT_FOUND');
    const ok = r.contactId
      ? customer.contacts.some((c) => c.id === r.contactId)
      : customer.self !== null;
    if (!ok) throw new CampaignError('CONTACT_NOT_OF_CUSTOMER');
  }
  const existing = await tx
    .select({
      id: campaignMessages.id,
      customerId: campaignMessages.customerId,
      contactId: campaignMessages.contactId,
    })
    .from(campaignMessages)
    .where(eq(campaignMessages.campaignId, campaignId));
  const key = (r: { customerId: string; contactId: string | null }) =>
    `${r.customerId}:${r.contactId ?? ''}`;
  const wanted = new Map(unique.map((r, i) => [key(r), i]));
  const gone = existing.filter((row) => !wanted.has(key(row))).map((row) => row.id);
  if (gone.length > 0) await tx.delete(campaignMessages).where(inArray(campaignMessages.id, gone));
  for (const row of existing) {
    const position = wanted.get(key(row));
    if (position !== undefined) {
      await tx.update(campaignMessages).set({ position }).where(eq(campaignMessages.id, row.id));
    }
  }
  const have = new Set(existing.map(key));
  const added = unique.filter((r) => !have.has(key(r)));
  if (added.length > 0) {
    await tx
      .insert(campaignMessages)
      .values(added.map((r) => ({ campaignId, ...r, position: wanted.get(key(r))! })));
  }
}

/** Step 1: the recipients as chosen; values, files and texts of the ones kept stay. */
export async function setRecipients(
  db: Db,
  id: string,
  recipients: { customerId: string; contactId: string | null }[],
) {
  return db.transaction(async (tx) => {
    await draft(tx, id, true);
    await writeRecipients(tx, id, recipients);
    await touch(tx, id);
  });
}

// ---------------------------------------------------------------------------------------------
// Template and content

/** Step 2: the template's subject, body, fields and attachments become the draft's own copy. */
export async function chooseTemplate(db: Db, id: string, templateId: string | null) {
  return db.transaction(async (tx) => {
    await draft(tx, id, true);
    let content = {
      templateId: null as string | null,
      subject: EMPTY_SUBJECT,
      body: EMPTY_BODY,
      customFields: [] as CustomField[],
    };
    let fileIds: string[] = [];
    if (templateId) {
      const [template] = await tx
        .select()
        .from(emailTemplates)
        .where(and(eq(emailTemplates.id, templateId), eq(emailTemplates.active, true)));
      if (!template) throw new CampaignError('TEMPLATE_NOT_FOUND');
      content = {
        templateId,
        subject: template.subject,
        body: template.body,
        customFields: template.customFields,
      };
      const attached = await tx
        .select({ fileId: emailTemplateAttachments.fileId })
        .from(emailTemplateAttachments)
        .innerJoin(files, eq(files.id, emailTemplateAttachments.fileId))
        .where(and(eq(emailTemplateAttachments.templateId, templateId), isNull(files.deletedAt)))
        .orderBy(asc(emailTemplateAttachments.position));
      fileIds = attached.map((row) => row.fileId);
    }
    await tx
      .update(campaigns)
      .set({ ...content, commonValues: {}, updatedAt: new Date() })
      .where(eq(campaigns.id, id));
    await writeCommonAttachments(tx, id, fileIds);
    // A new template's text replaces every recipient's own edit of the old one.
    await tx
      .update(campaignMessages)
      .set({ bodyOverride: null })
      .where(eq(campaignMessages.campaignId, id));
  });
}

async function liveFiles(tx: Db | Tx, fileIds: string[]) {
  const unique = [...new Set(fileIds)];
  if (unique.length === 0) return;
  const found = await tx
    .select({ id: files.id })
    .from(files)
    .where(
      and(inArray(files.id, unique), isNull(files.deletedAt), isNotNull(files.currentVersionId)),
    );
  if (found.length !== unique.length) throw new CampaignError('FILE_NOT_FOUND');
}

async function writeCommonAttachments(tx: Tx, campaignId: string, fileIds: string[]) {
  await tx.delete(campaignAttachments).where(eq(campaignAttachments.campaignId, campaignId));
  const unique = [...new Set(fileIds)];
  if (unique.length > 0) {
    await tx
      .insert(campaignAttachments)
      .values(unique.map((fileId, position) => ({ campaignId, fileId, position })));
  }
}

/** Step 3: what everybody gets. */
export async function saveContent(
  db: Db,
  input: {
    id: string;
    subject: EmailNode;
    body: EmailNode;
    customFields: CustomField[];
    commonValues: Record<string, string>;
    attachmentFileIds: string[];
  },
) {
  return db.transaction(async (tx) => {
    await draft(tx, input.id, true);
    await liveFiles(tx, input.attachmentFileIds);
    await tx
      .update(campaigns)
      .set({
        subject: input.subject,
        body: input.body,
        customFields: input.customFields,
        commonValues: input.commonValues,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, input.id));
    await writeCommonAttachments(tx, input.id, input.attachmentFileIds);
  });
}

/** Steps 3 and 4: one recipient's values, files and (optionally) their own text. */
export async function saveRecipientContent(
  db: Db,
  input: {
    messageId: string;
    values: Record<string, string>;
    ownFileIds: string[];
    bodyOverride?: EmailNode | null | undefined;
  },
) {
  return db.transaction(async (tx) => {
    const [message] = await tx
      .select({ campaignId: campaignMessages.campaignId })
      .from(campaignMessages)
      .where(eq(campaignMessages.id, input.messageId));
    if (!message) throw new CampaignError('NOT_FOUND');
    await draft(tx, message.campaignId, true);
    await liveFiles(tx, input.ownFileIds);
    await tx
      .update(campaignMessages)
      .set({
        values: input.values,
        ownFileIds: [...new Set(input.ownFileIds)],
        ...(input.bodyOverride !== undefined ? { bodyOverride: input.bodyOverride } : {}),
      })
      .where(eq(campaignMessages.id, input.messageId));
    await touch(tx, message.campaignId);
  });
}

export async function deleteDraft(db: Db, id: string) {
  return db.transaction(async (tx) => {
    await draft(tx, id, true);
    await tx.delete(campaigns).where(eq(campaigns.id, id));
  });
}

// ---------------------------------------------------------------------------------------------
// Reading

/** The wizard's whole draft, or a sent campaign: content, recipients with their state. */
export async function getCampaign(db: Db, id: string) {
  const [row] = await db
    .select({
      campaign: campaigns,
      templateName: emailTemplates.name,
      senderName: users.name,
      senderEmail: users.email,
    })
    .from(campaigns)
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.templateId))
    .innerJoin(users, eq(users.id, campaigns.senderUserId))
    .where(eq(campaigns.id, id));
  if (!row) throw new CampaignError('NOT_FOUND');
  const c = row.campaign;
  const attachments = await db
    .select({
      id: files.id,
      name: files.name,
      size: fileVersions.size,
      trashed: sql<boolean>`${files.deletedAt} is not null`,
    })
    .from(campaignAttachments)
    .innerJoin(files, eq(files.id, campaignAttachments.fileId))
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(eq(campaignAttachments.campaignId, id))
    .orderBy(asc(campaignAttachments.position));
  const messages = await db
    .select({
      id: campaignMessages.id,
      customerId: campaignMessages.customerId,
      contactId: campaignMessages.contactId,
      customerName: customers.name,
      customerKind: customers.kind,
      contactTitleBefore: contacts.titleBefore,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactTitleAfter: contacts.titleAfter,
      contactSalutation: contacts.salutation,
      contactEmail: contacts.email,
      contactUnsubscribedAt: contacts.unsubscribedAt,
      contactEmailStatus: contacts.emailStatus,
      customerSalutation: customers.salutation,
      customerEmail: customers.email,
      customerUnsubscribedAt: customers.unsubscribedAt,
      customerEmailStatus: customers.emailStatus,
      values: campaignMessages.values,
      ownFileIds: campaignMessages.ownFileIds,
      bodyOverride: campaignMessages.bodyOverride,
      status: campaignMessages.status,
      skipReason: campaignMessages.skipReason,
      toEmail: campaignMessages.toEmail,
      toName: campaignMessages.toName,
      errorCode: campaignMessages.errorCode,
      totalBytes: campaignMessages.totalBytes,
      sentAt: campaignMessages.sentAt,
      deliveredAt: campaignMessages.deliveredAt,
      bouncedAt: campaignMessages.bouncedAt,
      complainedAt: campaignMessages.complainedAt,
    })
    .from(campaignMessages)
    .innerJoin(customers, eq(customers.id, campaignMessages.customerId))
    .leftJoin(contacts, eq(contacts.id, campaignMessages.contactId))
    .where(eq(campaignMessages.campaignId, id))
    .orderBy(asc(campaignMessages.position));
  const ownIds = [...new Set(messages.flatMap((m) => m.ownFileIds))];
  const own =
    ownIds.length === 0
      ? []
      : await db
          .select({
            id: files.id,
            name: files.name,
            size: fileVersions.size,
            trashed: sql<boolean>`${files.deletedAt} is not null`,
          })
          .from(files)
          .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
          .where(inArray(files.id, ownIds));
  const ownFiles = new Map(own.map((f) => [f.id, f]));
  const fieldsMissing = (values: Record<string, string>) =>
    c.customFields
      .filter((f) => !(f.scope === 'common' ? c.commonValues[f.key] : values[f.key])?.trim())
      .map((f) => f.key);
  return {
    id: c.id,
    status: c.status,
    templateId: c.templateId,
    templateName: row.templateName,
    subject: c.subject ?? EMPTY_SUBJECT,
    body: c.body ?? EMPTY_BODY,
    customFields: c.customFields,
    commonValues: c.commonValues,
    subjectText: c.subjectText,
    senderUserId: c.senderUserId,
    sender: { name: row.senderName, email: row.senderEmail },
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    sentAt: c.sentAt,
    scheduledAt: c.scheduledAt,
    attachments,
    messages: messages.map((m) => {
      const person = m.contactId
        ? {
            name: personName({
              titleBefore: m.contactTitleBefore,
              firstName: m.contactFirstName ?? '',
              lastName: m.contactLastName ?? '',
              titleAfter: m.contactTitleAfter,
            }),
            salutation: m.contactSalutation,
            email: m.contactEmail,
            unsubscribedAt: m.contactUnsubscribedAt,
            emailStatus: m.contactEmailStatus ?? 'ok',
          }
        : {
            name: m.customerName,
            salutation: m.customerSalutation,
            email: m.customerEmail,
            unsubscribedAt: m.customerUnsubscribedAt,
            emailStatus: m.customerEmailStatus,
          };
      const draftState = c.status === 'draft';
      return {
        id: m.id,
        customerId: m.customerId,
        contactId: m.contactId,
        customerName: m.customerName,
        customerKind: m.customerKind,
        name: draftState ? person.name : (m.toName ?? person.name),
        email: draftState ? person.email : m.toEmail,
        salutation: person.salutation,
        values: m.values,
        ownFiles: m.ownFileIds.map((fileId) => ownFiles.get(fileId)).filter((f) => f !== undefined),
        edited: m.bodyOverride !== null,
        bodyOverride: m.bodyOverride,
        status: m.status,
        skipReason: draftState ? skipReasonOf(person) : (m.skipReason as SkipReason | null),
        missing: draftState ? fieldsMissing(m.values) : [],
        errorCode: m.errorCode,
        totalBytes: m.totalBytes,
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        bouncedAt: m.bouncedAt,
        complainedAt: m.complainedAt,
      };
    }),
  };
}

/** Odoslané or the drafts: the newest first, with the counts the list shows. */
export async function listCampaigns(db: Db, status: 'sent' | 'draft', page: number) {
  const PAGE = 20;
  const where =
    status === 'draft'
      ? eq(campaigns.status, 'draft')
      : inArray(campaigns.status, ['sending', 'sent', 'scheduled', 'cancelled']);
  const count = (condition: string) =>
    sql<number>`(select count(*)::int from campaign_messages m
      where m.campaign_id = "campaigns"."id" and ${sql.raw(condition)})`;
  const rows = await db
    .select({
      id: campaigns.id,
      status: campaigns.status,
      subjectText: campaigns.subjectText,
      subject: campaigns.subject,
      customFields: campaigns.customFields,
      updatedAt: campaigns.updatedAt,
      sentAt: campaigns.sentAt,
      senderName: users.name,
      templateName: emailTemplates.name,
      recipients: count(`m.status <> 'skipped'`),
      skipped: count(`m.status = 'skipped'`),
      delivered: count(`m.status = 'delivered'`),
      bounced: count(`m.status in ('bounced', 'complained', 'failed')`),
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.senderUserId))
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.templateId))
    .where(where)
    .orderBy(desc(status === 'draft' ? campaigns.updatedAt : campaigns.sentAt))
    .limit(PAGE)
    .offset((page - 1) * PAGE);
  return {
    total: rows[0]?.total ?? 0,
    items: rows.map(({ subject, customFields, ...row }) => ({
      ...row,
      subjectText: row.subjectText ?? (subject ? plainOf(subject, {}, labelsOf(customFields)) : ''),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering

/**
 * The unsubscribe token of a message: derived from its id with a server key, so the link in the
 * e-mail and the `List-Unsubscribe` header can be made again at sending; only its hash is stored.
 */
export function unsubscribeToken(env: Env, messageId: string) {
  return createHmac('sha256', env.DATA_ENCRYPTION_KEY)
    .update(`unsubscribe:${messageId}`)
    .digest('base64url');
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

type Campaign = Awaited<ReturnType<typeof getCampaign>>;
type Message = Campaign['messages'][number];

/** One recipient's e-mail as they would get it: values, their own text, the company look. */
async function renderFor(
  db: Db | Tx,
  env: Env,
  campaign: Campaign,
  message: Message,
  unsubscribeUrl: string,
) {
  const { values, customerName } = await valuesFor(
    db,
    message.contactId ? { contactId: message.contactId } : { customerId: message.customerId },
    campaign.senderUserId,
    { ...campaign.commonValues, ...message.values },
  );
  const body = message.bodyOverride ?? campaign.body;
  const rendered = await renderEmail({
    look: await getLook(db),
    baseUrl: env.WEB_URL,
    subject: campaign.subject,
    body,
    values,
    labels: labelsOf(campaign.customFields),
    signature: true,
    customerName,
    unsubscribeUrl,
  });
  return { ...rendered, missing: missingOf([campaign.subject, body], values) };
}

/** Step 4's preview, or a sent message's exact copy. */
export async function previewMessage(db: Db, env: Env, messageId: string) {
  const [row] = await db
    .select({
      campaignId: campaignMessages.campaignId,
      html: campaignMessages.html,
      subject: campaignMessages.subject,
    })
    .from(campaignMessages)
    .where(eq(campaignMessages.id, messageId));
  if (!row) throw new CampaignError('NOT_FOUND');
  const campaign = await getCampaign(db, row.campaignId);
  const message = campaign.messages.find((m) => m.id === messageId)!;
  const look = await getLook(db);
  const from = `${campaign.sender.name} | ${look.brandName} <${env.CAMPAIGN_FROM_ADDRESS}>`;
  if (campaign.status !== 'draft' && row.html) {
    return { subject: row.subject ?? '', html: row.html, missing: [], from, to: message.email };
  }
  const rendered = await renderFor(db, env, campaign, message, `${env.WEB_URL}/odhlasenie`);
  return {
    subject: rendered.subject,
    html: rendered.html,
    missing: rendered.missing,
    from,
    to: message.email,
  };
}

// ---------------------------------------------------------------------------------------------
// Sending

/** The versions an e-mail would carry today: the common files and the recipient's own. */
async function versionsOf(tx: Tx, fileIds: string[]) {
  if (fileIds.length === 0) return [];
  const rows = await tx
    .select({
      fileId: files.id,
      versionId: fileVersions.id,
      size: fileVersions.size,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(and(inArray(files.id, fileIds), isNull(files.deletedAt)));
  if (rows.length !== new Set(fileIds).size) throw new CampaignError('FILE_NOT_FOUND');
  return fileIds.map((id) => rows.find((r) => r.fileId === id)!);
}

/**
 * „Odoslať“: every recipient's exact e-mail is rendered and stored with the versions of its
 * attachments, and queued for the worker. Refused while a value is missing anywhere (spec 6.3)
 * or a message would exceed 40 MB (D-26). Recipients who unsubscribed or whose address bounced
 * since the draft was made are left out now.
 */
/** A scheduled time must be at least this far ahead: the worker needs a moment, and so do we. */
const MIN_SCHEDULE_MS = 5 * 60_000;

/**
 * „Odoslať“: every e-mail rendered, stored and queued. With `at` (D-12) the campaign is
 * „scheduled“: its messages wait in the queue until then, and it can be called back until it starts.
 */
export async function queueCampaign(db: Db, env: Env, id: string, at?: Date) {
  if (
    at &&
    (at.getTime() < Date.now() + MIN_SCHEDULE_MS ||
      at.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000)
  ) {
    throw new CampaignError('BAD_SCHEDULE');
  }
  const campaign = await getCampaign(db, id);
  if (campaign.status !== 'draft') throw new CampaignError('NOT_DRAFT');
  const bodyText = JSON.stringify(campaign.body);
  if (!bodyText.includes('"text"') && !bodyText.includes('"variable"')) {
    throw new CampaignError('NO_CONTENT');
  }
  const sendable = campaign.messages.filter((m) => !m.skipReason);
  if (sendable.length === 0) throw new CampaignError('NO_RECIPIENTS');

  const rendered = new Map<string, Awaited<ReturnType<typeof renderFor>> & { token: string }>();
  let missing = 0;
  for (const message of sendable) {
    const token = unsubscribeToken(env, message.id);
    const out = await renderFor(db, env, campaign, message, `${env.WEB_URL}/odhlasenie#${token}`);
    if (out.missing.length > 0) missing += 1;
    rendered.set(message.id, { ...out, token });
  }
  if (missing > 0) throw new CampaignError('MISSING_VALUES', missing);

  return db.transaction(async (tx) => {
    await draft(tx, id, true);
    const common = await versionsOf(
      tx,
      campaign.attachments.map((a) => a.id),
    );
    const now = new Date();
    const leaves = at ?? now;
    for (const message of campaign.messages) {
      if (message.skipReason) {
        await tx
          .update(campaignMessages)
          .set({
            status: 'skipped',
            skipReason: message.skipReason,
            toName: message.name,
            toEmail: message.email,
          })
          .where(eq(campaignMessages.id, message.id));
        continue;
      }
      const out = rendered.get(message.id)!;
      const own = await versionsOf(
        tx,
        message.ownFiles
          .map((f) => f.id)
          .filter((fileId) => !campaign.attachments.some((a) => a.id === fileId)),
      );
      const versions = [...common, ...own];
      const totalBytes =
        Buffer.byteLength(out.html) +
        versions.reduce((sum, v) => sum + Math.ceil((v.size * 4) / 3), 0);
      if (totalBytes > MAX_MESSAGE_BYTES) throw new CampaignError('TOO_LARGE');
      await tx
        .update(campaignMessages)
        .set({
          status: 'queued',
          toEmail: message.email,
          toName: message.name,
          subject: out.subject,
          html: out.html,
          text: out.text,
          totalBytes,
          unsubscribeTokenHash: tokenHash(out.token),
          queuedAt: now,
          nextAttemptAt: leaves,
        })
        .where(eq(campaignMessages.id, message.id));
      if (versions.length > 0) {
        await tx.insert(messageAttachments).values(
          versions.map((v, position) => ({
            messageId: message.id,
            fileVersionId: v.versionId,
            position,
          })),
        );
      }
    }
    await tx
      .update(campaigns)
      .set({
        status: at ? 'scheduled' : 'sending',
        sentAt: leaves,
        scheduledAt: at ?? null,
        subjectText: plainOf(campaign.subject, {}, labelsOf(campaign.customFields)),
        updatedAt: now,
      })
      .where(eq(campaigns.id, id));
    return {
      queued: sendable.length,
      skipped: campaign.messages.length - sendable.length,
      scheduledAt: at ?? null,
    };
  });
}

/**
 * „Zrušiť naplánovanie“: a scheduled campaign that has not started goes back to a draft, its
 * messages to the recipients' list as they were (the rendered copies and attachments forgotten).
 */
export async function unscheduleCampaign(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({ status: campaigns.status, scheduledAt: campaigns.scheduledAt })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .for('update');
    if (!campaign) throw new CampaignError('NOT_FOUND');
    if (campaign.status !== 'scheduled') throw new CampaignError('NOT_SCHEDULED');
    const messageIds = (
      await tx
        .select({ id: campaignMessages.id })
        .from(campaignMessages)
        .where(eq(campaignMessages.campaignId, id))
    ).map((m) => m.id);
    if (messageIds.length > 0) {
      await tx.delete(messageAttachments).where(inArray(messageAttachments.messageId, messageIds));
    }
    await tx
      .update(campaignMessages)
      .set({
        status: 'draft',
        skipReason: null,
        subject: null,
        html: null,
        text: null,
        totalBytes: null,
        unsubscribeTokenHash: null,
        queuedAt: null,
        nextAttemptAt: null,
      })
      .where(eq(campaignMessages.campaignId, id));
    await tx
      .update(campaigns)
      .set({ status: 'draft', scheduledAt: null, sentAt: null, updatedAt: new Date() })
      .where(eq(campaigns.id, id));
  });
}

/** „Poslať test“: the first recipient's e-mail, marked TEST, rendered for the sender's inbox. */
export async function testMessage(db: Db, env: Env, id: string) {
  const campaign = await getCampaign(db, id);
  const first = campaign.messages.find((m) => !m.skipReason);
  if (!first) throw new CampaignError('NO_RECIPIENTS');
  const out = await renderFor(db, env, campaign, first, `${env.WEB_URL}/odhlasenie`);
  const look = await getLook(db);
  return {
    to: campaign.sender.email,
    from: `${campaign.sender.name} | ${look.brandName} <${env.CAMPAIGN_FROM_ADDRESS}>`,
    subject: `${sk.campaigns.review.testPrefix} ${out.subject}`,
    html: out.html,
    text: out.text,
    missing: out.missing.length,
  };
}

/**
 * A scheduled campaign whose time came is sending; a campaign whose messages all left the queue
 * is sent.
 */
export async function settleCampaigns(db: Db | Tx) {
  await db.execute(sql`
    update campaigns set status = 'sending', updated_at = now()
    where status = 'scheduled' and scheduled_at <= now()`);
  await db.execute(sql`
    update campaigns set status = 'sent', updated_at = now()
    where status = 'sending' and not exists (
      select 1 from campaign_messages m where m.campaign_id = campaigns.id and m.status = 'queued'
    )`);
}
