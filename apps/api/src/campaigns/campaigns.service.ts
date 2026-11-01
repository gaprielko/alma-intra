import { sk } from '@intra/shared/i18n';
import {
  type LookKind,
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
import { fileUnder } from '../customers/customers.service.js';
import {
  campaignAttachments,
  campaignMessages,
  campaigns,
  contactLinks,
  contacts,
  emailTemplateAttachments,
  emailTemplates,
  files,
  fileVersions,
  fullNameOf,
  messageAttachments,
  organizations,
  users,
} from '../db/schema/index.js';
import { missingOf, plainOf, renderEmail } from '../email/render.js';
import { fromAddress, lookFor, valuesFor } from '../email/templates.service.js';
import { DOWNLOAD_LINK_DAYS, downloadToken } from './download-link.js';
import { activityUrl, type RecordedActivity } from './interest-link.js';

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

/**
 * The subject the lists show: values everybody shares (the common custom fields) filled in, the
 * per-recipient ones by their label („Ponuka pre [Názov kontaktu]“).
 */
const listSubject = (
  subject: EmailNode,
  fields: CustomField[],
  commonValues: Record<string, string>,
) =>
  plainOf(
    subject,
    Object.fromEntries(
      Object.entries(commonValues)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => [`custom.${key}`, value.trim()]),
    ),
    labelsOf(fields),
  );

export async function draft(tx: Db | Tx, id: string, lock = false) {
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
 * The organizations of the recipients step: each with the contacts an e-mail could go to, the primary
 * first, then the persons of its prevádzky by prevádzka (P-13), and why one would be left out. A
 * private person is their own recipient.
 */
export async function recipientCandidates(db: Db | Tx, customerIds: string[]) {
  if (customerIds.length === 0) return [];
  const branches = await db
    .select({ id: organizations.id, name: organizations.name, parentId: organizations.parentId })
    .from(organizations)
    .where(and(inArray(organizations.parentId, customerIds), isNull(organizations.deletedAt)));
  const branchOf = new Map(branches.map((b) => [b.id, b]));
  const [rows, people] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        kind: organizations.kind,
        city: organizations.city,
        status: organizations.status,
      })
      .from(organizations)
      .where(and(inArray(organizations.id, customerIds), isNull(organizations.deletedAt))),
    db
      .select({
        id: contacts.id,
        customerId: contactLinks.organizationId,
        titleBefore: contacts.titleBefore,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        titleAfter: contacts.titleAfter,
        email: contacts.email,
        isPrimary: contactLinks.isPrimary,
        unsubscribedAt: contacts.unsubscribedAt,
        emailStatus: contacts.emailStatus,
      })
      .from(contactLinks)
      .innerJoin(contacts, eq(contacts.id, contactLinks.contactId))
      .where(
        and(
          inArray(contactLinks.organizationId, [...customerIds, ...branchOf.keys()]),
          isNull(contacts.deletedAt),
        ),
      )
      .orderBy(desc(contactLinks.isPrimary), asc(contacts.lastName)),
  ]);
  // The head organization of a link: its own id, or the prevádzka's organization.
  const headOf = (organizationId: string) =>
    branchOf.get(organizationId)?.parentId ?? organizationId;
  const order = new Map(customerIds.map((id, i) => [id, i]));
  return rows
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((customer) => ({
      id: customer.id,
      name: customer.name,
      kind: customer.kind,
      city: customer.city,
      status: customer.status,
      contacts: contactsOf(
        people.filter((p) => headOf(p.customerId) === customer.id),
        customer.id,
        branchOf,
      ),
    }));
}

/**
 * One row per person: at the organization (primary first), then by prevádzka; a person at both
 * counts as the organization's, `isPrimary` is the organization's primary contact.
 */
function contactsOf(
  links: {
    id: string;
    customerId: string;
    titleBefore: string | null;
    firstName: string;
    lastName: string;
    titleAfter: string | null;
    email: string | null;
    isPrimary: boolean;
    unsubscribedAt: Date | null;
    emailStatus: Parameters<typeof skipReasonOf>[0]['emailStatus'];
  }[],
  customerId: string,
  branchOf: Map<string, { id: string; name: string }>,
) {
  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      email: string | null;
      isPrimary: boolean;
      establishment: { id: string; name: string; isPrimary: boolean } | null;
      skipReason: ReturnType<typeof skipReasonOf>;
    }
  >();
  for (const link of links) {
    const atOrganization = link.customerId === customerId;
    const branch = branchOf.get(link.customerId);
    const known = byId.get(link.id);
    if (known && (!atOrganization || known.establishment === null)) continue;
    byId.set(link.id, {
      id: link.id,
      name: personName(link),
      email: link.email,
      isPrimary: atOrganization && link.isPrimary,
      establishment:
        atOrganization || !branch
          ? null
          : { id: branch.id, name: branch.name, isPrimary: link.isPrimary },
      skipReason: skipReasonOf(link),
    });
  }
  return [...byId.values()].sort(
    (a, b) =>
      Number(a.establishment !== null) - Number(b.establishment !== null) ||
      (a.establishment?.name ?? '').localeCompare(b.establishment?.name ?? '', 'sk') ||
      Number(b.isPrimary || Boolean(b.establishment?.isPrimary)) -
        Number(a.isPrimary || Boolean(a.establishment?.isPrimary)),
  );
}

/** The default recipients of a customer: a private person, or the primary contact. */
function defaultRecipients(
  candidates: Awaited<ReturnType<typeof recipientCandidates>>,
): { customerId: string; contactId: string | null }[] {
  return candidates.flatMap((customer): { customerId: string; contactId: string | null }[] => {
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

/**
 * „Použiť znova“: a new draft of a campaign (usually a sent one) with its content, common files and
 * recipients, each with their values, own files and own text. Contacts deleted since and files in
 * the trash are left out. The copy is a new e-mail, never an answer to a received one.
 */
export async function reuseCampaign(db: Db, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
    if (!source) throw new CampaignError('NOT_FOUND');
    const [created] = await tx
      .insert(campaigns)
      .values({
        senderUserId: userId,
        templateId: source.templateId,
        lookProductId: source.lookProductId,
        lookKind: source.lookKind,
        subject: source.subject,
        body: source.body,
        customFields: source.customFields,
        commonValues: source.commonValues,
        attachmentsAsLinks: source.attachmentsAsLinks,
      })
      .returning({ id: campaigns.id });
    const common = await tx
      .select({ fileId: campaignAttachments.fileId })
      .from(campaignAttachments)
      .innerJoin(files, eq(files.id, campaignAttachments.fileId))
      .where(and(eq(campaignAttachments.campaignId, id), isNull(files.deletedAt)))
      .orderBy(asc(campaignAttachments.position));
    await writeCommonAttachments(
      tx,
      created!.id,
      common.map((row) => row.fileId),
    );
    const messages = await tx
      .select()
      .from(campaignMessages)
      .where(eq(campaignMessages.campaignId, id))
      .orderBy(asc(campaignMessages.position));
    const candidates = await recipientCandidates(tx, [
      // A bulk e-mail: its recipients all have an organization.
      ...new Set(messages.map((m) => m.organizationId!)),
    ]);
    const kept = messages.filter((m) => {
      const customer = candidates.find((c) => c.id === m.organizationId);
      if (!customer) return false;
      return m.contactId !== null && customer.contacts.some((c) => c.id === m.contactId);
    });
    const ownIds = [...new Set(kept.flatMap((m) => m.ownFileIds))];
    const live = new Set(
      ownIds.length === 0
        ? []
        : (
            await tx
              .select({ id: files.id })
              .from(files)
              .where(and(inArray(files.id, ownIds), isNull(files.deletedAt)))
          ).map((row) => row.id),
    );
    if (kept.length > 0) {
      await tx.insert(campaignMessages).values(
        kept.map((m, position) => ({
          campaignId: created!.id,
          organizationId: m.organizationId,
          contactId: m.contactId,
          position,
          values: m.values,
          ownFileIds: m.ownFileIds.filter((fileId) => live.has(fileId)),
          bodyOverride: m.bodyOverride,
        })),
      );
    }
    return { id: created!.id, left: messages.length - kept.length };
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
    // Every recipient is a person since stage O2, a private person included.
    const ok = r.contactId !== null && customer.contacts.some((c) => c.id === r.contactId);
    if (!ok) throw new CampaignError('CONTACT_NOT_OF_CUSTOMER');
  }
  const existing = await tx
    .select({
      id: campaignMessages.id,
      customerId: campaignMessages.organizationId,
      contactId: campaignMessages.contactId,
    })
    .from(campaignMessages)
    .where(eq(campaignMessages.campaignId, campaignId));
  const key = (r: { customerId: string | null; contactId: string | null }) =>
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
    await tx.insert(campaignMessages).values(
      added.map((r) => ({
        campaignId,
        organizationId: r.customerId,
        contactId: r.contactId,
        position: wanted.get(key(r))!,
      })),
    );
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
      lookProductId: null as string | null,
      lookKind: 'personal' as LookKind,
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
        lookProductId: template.lookProductId,
        lookKind: template.lookKind,
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

export async function liveFiles(tx: Db | Tx, fileIds: string[]) {
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

export async function writeCommonAttachments(tx: Tx, campaignId: string, fileIds: string[]) {
  await tx.delete(campaignAttachments).where(eq(campaignAttachments.campaignId, campaignId));
  const unique = [...new Set(fileIds)];
  if (unique.length > 0) {
    await tx
      .insert(campaignAttachments)
      .values(unique.map((fileId, position) => ({ campaignId, fileId, position })));
  }
}

/** Review step: the files go as download links valid 30 days instead of attachments (D-26). */
export async function setAttachmentsAsLinks(db: Db, id: string, asLinks: boolean) {
  return db.transaction(async (tx) => {
    await draft(tx, id, true);
    await tx
      .update(campaigns)
      .set({ attachmentsAsLinks: asLinks, updatedAt: new Date() })
      .where(eq(campaigns.id, id));
  });
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
      senderName: fullNameOf(users),
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
      customerId: campaignMessages.organizationId,
      contactId: campaignMessages.contactId,
      recipientRole: campaignMessages.recipientRole,
      customerName: organizations.name,
      customerKind: organizations.kind,
      contactTitleBefore: contacts.titleBefore,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactTitleAfter: contacts.titleAfter,
      contactSalutation: contacts.salutation,
      contactEmail: contacts.email,
      contactUnsubscribedAt: contacts.unsubscribedAt,
      contactEmailStatus: contacts.emailStatus,
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
    .leftJoin(organizations, eq(organizations.id, campaignMessages.organizationId))
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
    kind: c.kind,
    lookProductId: c.lookProductId,
    lookKind: c.lookKind,
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
    attachmentsAsLinks: c.attachmentsAsLinks,
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
            // A message names its person since stage O2; an older one without stays readable.
            name: m.customerName ?? m.toEmail ?? '',
            salutation: null,
            email: null,
            unsubscribedAt: null,
            emailStatus: 'ok' as const,
          };
      const draftState = c.status === 'draft';
      return {
        // The wizard only opens bulk e-mails, whose recipients all have an organization.
        customerId: m.customerId as string,
        recipientRole: m.recipientRole,
        id: m.id,
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
      kind: campaigns.kind,
      subjectText: campaigns.subjectText,
      subject: campaigns.subject,
      customFields: campaigns.customFields,
      commonValues: campaigns.commonValues,
      updatedAt: campaigns.updatedAt,
      sentAt: campaigns.sentAt,
      senderName: fullNameOf(users),
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
    items: rows.map(({ subject, customFields, commonValues, ...row }) => ({
      ...row,
      subjectText:
        row.subjectText ?? (subject ? listSubject(subject, customFields, commonValues) : ''),
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
/**
 * The files of one recipient's e-mail as download links (D-26): the common ones and the
 * recipient's own, each to its current version, valid 30 days from when the e-mail leaves.
 */
async function downloadsFor(
  db: Db | Tx,
  env: Env,
  campaign: Campaign,
  message: Message,
  leaves: Date,
) {
  const named = [
    ...campaign.attachments,
    ...message.ownFiles.filter((f) => !campaign.attachments.some((a) => a.id === f.id)),
  ];
  const versions = await versionsOf(
    db,
    named.map((f) => f.id),
  );
  const expiresAt = new Date(leaves.getTime() + DOWNLOAD_LINK_DAYS * 86_400_000);
  return {
    expiresAt,
    files: versions.map((v, i) => ({
      name: named[i]!.name,
      url: `${env.WEB_URL}/d/${downloadToken(env, v.versionId, expiresAt)}`,
    })),
  };
}

async function renderFor(
  db: Db | Tx,
  env: Env,
  campaign: Campaign,
  message: Message,
  unsubscribeUrl: string,
  leaves = new Date(),
  /** Only the e-mail that really leaves carries working links; a preview or a test does not. */
  live = false,
) {
  const { values, customerName } = await valuesFor(
    db,
    { contactId: message.contactId ?? undefined, customerId: message.customerId },
    campaign.senderUserId,
    { ...campaign.commonValues, ...message.values },
  );
  const body = message.bodyOverride ?? campaign.body;
  const rendered = await renderEmail({
    look: await lookFor(db, campaign.lookKind, campaign.lookProductId),
    baseUrl: env.WEB_URL,
    subject: campaign.subject,
    body,
    values,
    labels: labelsOf(campaign.customFields),
    signature: true,
    customerName,
    unsubscribeUrl,
    ...(live
      ? { activityUrl: (activity: RecordedActivity) => activityUrl(env, message.id, activity) }
      : {}),
    ...(campaign.attachmentsAsLinks
      ? { downloads: await downloadsFor(db, env, campaign, message, leaves) }
      : {}),
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
      fromName: campaignMessages.fromName,
    })
    .from(campaignMessages)
    .where(eq(campaignMessages.id, messageId));
  if (!row) throw new CampaignError('NOT_FOUND');
  const campaign = await getCampaign(db, row.campaignId);
  const message = campaign.messages.find((m) => m.id === messageId)!;
  const look = await lookFor(db, campaign.lookKind, campaign.lookProductId);
  if (campaign.status !== 'draft' && row.html) {
    return {
      subject: row.subject ?? '',
      html: row.html,
      missing: [],
      from: fromAddress(look, env.CAMPAIGN_FROM_ADDRESS, row.fromName),
      to: message.email,
    };
  }
  const rendered = await renderFor(db, env, campaign, message, `${env.WEB_URL}/odhlasenie`);
  return {
    subject: rendered.subject,
    html: rendered.html,
    missing: rendered.missing,
    from: fromAddress(look, env.CAMPAIGN_FROM_ADDRESS, rendered.fromName),
    to: message.email,
  };
}

// ---------------------------------------------------------------------------------------------
// Sending

/** The versions an e-mail would carry today: the common files and the recipient's own. */
export async function versionsOf(tx: Db | Tx, fileIds: string[]) {
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
    const out = await renderFor(
      db,
      env,
      campaign,
      message,
      `${env.WEB_URL}/odhlasenie#${token}`,
      at ?? new Date(),
      true,
    );
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
      // Links weigh nothing; attachments travel base64-encoded, a third bigger.
      const totalBytes =
        Buffer.byteLength(out.html) +
        (campaign.attachmentsAsLinks
          ? 0
          : versions.reduce((sum, v) => sum + Math.ceil((v.size * 4) / 3), 0));
      if (totalBytes > MAX_MESSAGE_BYTES) throw new CampaignError('TOO_LARGE');
      await tx
        .update(campaignMessages)
        .set({
          status: 'queued',
          // Filed by its recipient: at a prevádzka when the person is only there (P-11).
          organizationId: await fileUnder(
            tx,
            message.customerId,
            message.contactId ? [message.contactId] : [],
          ),
          toEmail: message.email,
          toName: message.name,
          fromName: out.fromName,
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
            asLink: campaign.attachmentsAsLinks,
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
        // One recipient: their own subject, as sent.
        subjectText:
          sendable.length === 1
            ? rendered.get(sendable[0]!.id)!.subject
            : listSubject(campaign.subject, campaign.customFields, campaign.commonValues),
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
  const look = await lookFor(db, campaign.lookKind, campaign.lookProductId);
  return {
    to: campaign.sender.email,
    from: fromAddress(look, env.CAMPAIGN_FROM_ADDRESS, out.fromName),
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
