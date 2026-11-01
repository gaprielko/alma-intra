import { type LeadActivityListInput, leadActivityListSchema } from '@intra/shared/schemas';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { maskEmail } from '../campaigns/delivery.js';
import { readActivityToken } from '../campaigns/interest-link.js';
import type { Env } from '../config/env.js';
import type { Db } from '../db/db.module.js';
import {
  activityTypes,
  appFeedback,
  appFeedbackEvents,
  campaignMessages,
  campaigns,
  contactFullName,
  contacts,
  emailTemplates,
  fullNameOf,
  leadActivities,
  organizations,
  products,
  users,
} from '../db/schema/index.js';
import { lookFor } from '../email/templates.service.js';
import { notify } from '../notifications/notifications.service.js';
import type { Storage } from '../storage/storage.js';

/** A refusal the web words for itself (`sk.leadActivities.errors`). */
export class LeadActivityError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'ORGANIZATION_NOT_FOUND' | 'CONTACT_NOT_FOUND') {
    super(code);
  }
}

const PAGE = 20;
const alive = isNull(leadActivities.deletedAt);
const parents = alias(organizations, 'parent_organization');
/** A day of the filter starts at midnight here, whatever the server's clock says. */
const startOfDay = (day: string) => sql`(${day}::date)::timestamp at time zone 'Europe/Bratislava'`;

/** What the list and the detail show of one entry. Never a podnet's text or its picture. */
const fields = {
  id: leadActivities.id,
  typeId: leadActivities.typeId,
  typeName: activityTypes.name,
  source: leadActivities.source,
  createdAt: leadActivities.createdAt,
  lastConfirmedAt: leadActivities.lastConfirmedAt,
  confirmedCount: leadActivities.confirmedCount,
  email: leadActivities.email,
  productId: products.id,
  productName: products.name,
  organizationId: organizations.id,
  organizationName: organizations.name,
  organizationRole: organizations.role,
  /** The organization of a prevádzka. */
  parentId: parents.id,
  parentName: parents.name,
  contactId: contacts.id,
  contactName: contactFullName,
  campaignId: campaignMessages.campaignId,
  subject: campaignMessages.subject,
  sentAt: campaignMessages.sentAt,
  feedbackKind: appFeedback.kind,
  feedbackClient: sql<string | null>`${appFeedback.app} ->> 'client'`,
  reporterName: appFeedback.reporterName,
  sourceOrganizationName: appFeedback.sourceOrganizationName,
  fileDraftId: leadActivities.fileDraftId,
  /** The file a draft from a public link is about, for the list. */
  fileName: sql<string | null>`(select f.name from file_drafts d join files f on f.id = d.file_id
    where d.id = ${leadActivities.fileDraftId})`,
};

const joined = (db: Db) =>
  db
    .select(fields)
    .from(leadActivities)
    .innerJoin(activityTypes, eq(activityTypes.id, leadActivities.typeId))
    .leftJoin(products, eq(products.id, leadActivities.productId))
    .leftJoin(organizations, eq(organizations.id, leadActivities.organizationId))
    .leftJoin(parents, eq(parents.id, organizations.parentId))
    .leftJoin(contacts, eq(contacts.id, leadActivities.contactId))
    .leftJoin(campaignMessages, eq(campaignMessages.id, leadActivities.campaignMessageId))
    .leftJoin(appFeedback, eq(appFeedback.id, leadActivities.appFeedbackId));

/** Aktivity: the newest first. An organization in the trash takes its entries along. */
export async function listLeadActivities(db: Db, raw: LeadActivityListInput) {
  const input = leadActivityListSchema.parse(raw);
  const pattern = input.search ? `%${input.search.replace(/[\\%_]/g, '\\$&')}%` : null;
  const where = and(
    alive,
    isNull(organizations.deletedAt),
    input.typeId ? eq(leadActivities.typeId, input.typeId) : undefined,
    input.productId ? eq(leadActivities.productId, input.productId) : undefined,
    input.from ? gte(leadActivities.createdAt, startOfDay(input.from)) : undefined,
    input.to
      ? lt(leadActivities.createdAt, sql`${startOfDay(input.to)} + interval '1 day'`)
      : undefined,
    pattern
      ? sql`(unaccent(${organizations.name}) ilike unaccent(${pattern})
          or ${leadActivities.email} ilike ${pattern}
          or unaccent(${contactFullName}) ilike unaccent(${pattern})
          or unaccent(${appFeedback.reporterName}) ilike unaccent(${pattern}))`
      : undefined,
  );
  const [items, [counted]] = await Promise.all([
    joined(db)
      .where(where)
      .orderBy(desc(leadActivities.createdAt))
      .limit(PAGE)
      .offset((input.page - 1) * PAGE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(leadActivities)
      .leftJoin(organizations, eq(organizations.id, leadActivities.organizationId))
      .leftJoin(contacts, eq(contacts.id, leadActivities.contactId))
      .leftJoin(appFeedback, eq(appFeedback.id, leadActivities.appFeedbackId))
      .where(where),
  ]);
  return { items, total: counted?.total ?? 0 };
}

/** One entry with the e-mail it came from: its template and who sent it. */
export async function getLeadActivity(db: Db, id: string) {
  const [row] = await joined(db).where(and(eq(leadActivities.id, id), alive));
  if (!row) throw new LeadActivityError('NOT_FOUND');
  const [person] = row.contactId
    ? await db
        .select({ phone: contacts.phone })
        .from(contacts)
        .where(eq(contacts.id, row.contactId))
    : [];
  const [source] = row.campaignId
    ? await db
        .select({
          templateId: emailTemplates.id,
          templateName: emailTemplates.name,
          sender: fullNameOf(users),
        })
        .from(campaigns)
        .innerJoin(users, eq(users.id, campaigns.senderUserId))
        .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.templateId))
        .where(eq(campaigns.id, row.campaignId))
    : [];
  return {
    ...row,
    phone: person?.phone ?? null,
    templateId: source?.templateId ?? null,
    templateName: source?.templateName ?? null,
    sender: source?.sender ?? null,
  };
}

/**
 * A podnet's own content, which may hold health data (docs/activities-from-apps.md, section 6): only
 * here, one read per opening, and the router records it.
 */
export async function getFeedbackContent(db: Db, storage: Storage | null, id: string) {
  const [row] = await db
    .select({ feedback: appFeedback })
    .from(leadActivities)
    .innerJoin(appFeedback, eq(appFeedback.id, leadActivities.appFeedbackId))
    .where(and(eq(leadActivities.id, id), alive));
  if (!row) throw new LeadActivityError('NOT_FOUND');
  const { feedback } = row;
  const events = await db
    .select({
      id: appFeedbackEvents.id,
      kind: appFeedbackEvents.kind,
      body: appFeedbackEvents.body,
      works: appFeedbackEvents.works,
      sentAt: appFeedbackEvents.sentAt,
    })
    .from(appFeedbackEvents)
    .where(eq(appFeedbackEvents.feedbackId, feedback.id))
    .orderBy(asc(appFeedbackEvents.sentAt));
  const screenshot =
    feedback.screenshotKey && storage
      ? await storage.createDownloadUrl(feedback.screenshotKey, {
          fileName: 'podnet.jpg',
          contentType: 'image/jpeg',
          inline: true,
        })
      : null;
  return {
    whatDoing: feedback.whatDoing,
    expected: feedback.expected,
    reporterRole: feedback.reporterRole,
    app: feedback.app,
    device: feedback.device,
    place: feedback.place,
    trail: feedback.trail,
    apiCalls: feedback.apiCalls,
    errors: feedback.errors,
    pendingSync: feedback.pendingSync,
    screenshotUrl: screenshot?.url ?? null,
    events,
  };
}

/** The organization or the contact of a podnet that matched none. */
export async function assignLeadActivity(
  db: Db,
  id: string,
  target: { organizationId?: string | undefined; contactId?: string | undefined },
) {
  if (target.organizationId) {
    const [organization] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, target.organizationId), isNull(organizations.deletedAt)));
    if (!organization) throw new LeadActivityError('ORGANIZATION_NOT_FOUND');
  }
  if (target.contactId) {
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, target.contactId), isNull(contacts.deletedAt)));
    if (!contact) throw new LeadActivityError('CONTACT_NOT_FOUND');
  }
  const [row] = await db
    .update(leadActivities)
    .set({
      ...(target.organizationId ? { organizationId: target.organizationId } : {}),
      ...(target.contactId ? { contactId: target.contactId } : {}),
    })
    .where(and(eq(leadActivities.id, id), eq(leadActivities.source, 'app'), alive))
    .returning({ id: leadActivities.id, typeId: leadActivities.typeId });
  if (!row) throw new LeadActivityError('NOT_FOUND');
  return row;
}

/** A podnet's `app_feedback` stays: Alma can still send replies to it. */
export async function deleteLeadActivity(db: Db, id: string) {
  const [row] = await db
    .update(leadActivities)
    .set({ deletedAt: new Date() })
    .where(and(eq(leadActivities.id, id), alive))
    .returning({
      id: leadActivities.id,
      typeId: leadActivities.typeId,
      productId: leadActivities.productId,
    });
  if (!row) throw new LeadActivityError('NOT_FOUND');
  return row;
}

/**
 * Who a token speaks for: a message that really left, to a live organization, a type a button can
 * record, and the product when the type asks for one. A type switched off still records: a button
 * already sent keeps working.
 */
async function targetOf(db: Db, env: Env, token: string) {
  const read = readActivityToken(env, token);
  if (!read) return null;
  const [row] = await db
    .select({
      messageId: campaignMessages.id,
      organizationId: campaignMessages.organizationId,
      contactId: campaignMessages.contactId,
      email: campaignMessages.toEmail,
      subject: campaignMessages.subject,
      senderUserId: campaigns.senderUserId,
      typeId: activityTypes.id,
      typeName: activityTypes.name,
      confirmLabel: activityTypes.confirmLabel,
      asksProduct: activityTypes.asksProduct,
      productId: products.id,
      productName: products.name,
    })
    .from(campaignMessages)
    .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
    .innerJoin(organizations, eq(organizations.id, campaignMessages.organizationId))
    .innerJoin(activityTypes, eq(activityTypes.id, read.typeId))
    .leftJoin(products, read.productId ? eq(products.id, read.productId) : sql`false`)
    .where(
      and(
        eq(campaignMessages.id, read.messageId),
        inArray(campaignMessages.status, ['sent', 'delivered']),
        isNull(organizations.deletedAt),
      ),
    );
  if (!row?.organizationId || !row.confirmLabel) return null;
  if (row.asksProduct && !row.productId) return null;
  return { ...row, organizationId: row.organizationId, confirmLabel: row.confirmLabel };
}

type Target = NonNullable<Awaited<ReturnType<typeof targetOf>>>;

const sameActivity = (target: Target) =>
  and(
    eq(leadActivities.typeId, target.typeId),
    eq(leadActivities.source, 'email'),
    eq(leadActivities.organizationId, target.organizationId),
    target.contactId
      ? eq(leadActivities.contactId, target.contactId)
      : isNull(leadActivities.contactId),
    target.productId
      ? eq(leadActivities.productId, target.productId)
      : isNull(leadActivities.productId),
    alive,
  );

/**
 * What the public page shows before anything happens. Opening it records nothing: a mail scanner
 * opens links too (docs/activities.md, A-1).
 */
export async function activityInfo(db: Db, env: Env, token: string) {
  const target = await targetOf(db, env, token);
  if (!target) return null;
  const look = await lookFor(db, 'personal', target.productId);
  return {
    email: maskEmail(target.email),
    type: target.typeName,
    typeId: target.typeId,
    confirmLabel: target.confirmLabel,
    product: target.productName,
    brand: look.brandName,
    contact: look.footerEmail || look.replyToAddress || null,
  };
}

/**
 * The confirm button: the first confirmation makes the entry and tells whoever sent the e-mail,
 * a further one only moves `lastConfirmedAt` and adds to the count.
 */
export async function confirmActivity(db: Db, env: Env, token: string) {
  const target = await targetOf(db, env, token);
  if (!target) return null;
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(leadActivities)
      .values({
        typeId: target.typeId,
        productId: target.productId,
        organizationId: target.organizationId,
        contactId: target.contactId,
        campaignMessageId: target.messageId,
        email: target.email,
      })
      .onConflictDoNothing()
      .returning({ id: leadActivities.id });
    if (created) {
      await notify(tx, {
        userId: target.senderUserId,
        kind: 'interest',
        refId: created.id,
        customerId: target.organizationId,
        subject: target.subject,
      });
    } else {
      await tx
        .update(leadActivities)
        .set({
          lastConfirmedAt: new Date(),
          confirmedCount: sql`${leadActivities.confirmedCount} + 1`,
        })
        .where(sameActivity(target));
    }
    return { ...target, repeated: !created };
  });
}
