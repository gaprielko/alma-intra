import { type LeadActivityListInput, leadActivityListSchema } from '@intra/shared/schemas';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { maskEmail } from '../campaigns/delivery.js';
import { readInterestToken } from '../campaigns/interest-link.js';
import type { Env } from '../config/env.js';
import type { Db } from '../db/db.module.js';
import {
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

/** A refusal the web words for itself (`sk.leadActivities.errors`). */
export class LeadActivityError extends Error {
  constructor(readonly code: 'NOT_FOUND') {
    super(code);
  }
}

const PAGE = 20;
const alive = isNull(leadActivities.deletedAt);
const parents = alias(organizations, 'parent_organization');
/** A day of the filter starts at midnight here, whatever the server's clock says. */
const startOfDay = (day: string) => sql`(${day}::date)::timestamp at time zone 'Europe/Bratislava'`;

/** What the list and the detail show of one entry. */
const fields = {
  id: leadActivities.id,
  type: leadActivities.type,
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
  parentName: parents.name,
  contactId: contacts.id,
  contactName: contactFullName,
  campaignId: campaignMessages.campaignId,
  subject: campaignMessages.subject,
  sentAt: campaignMessages.sentAt,
};

const joined = (db: Db) =>
  db
    .select(fields)
    .from(leadActivities)
    .innerJoin(products, eq(products.id, leadActivities.productId))
    .innerJoin(organizations, eq(organizations.id, leadActivities.organizationId))
    .leftJoin(parents, eq(parents.id, organizations.parentId))
    .leftJoin(contacts, eq(contacts.id, leadActivities.contactId))
    .leftJoin(campaignMessages, eq(campaignMessages.id, leadActivities.campaignMessageId));

/** Aktivity: the newest first. An organization in the trash takes its entries along. */
export async function listLeadActivities(db: Db, raw: LeadActivityListInput) {
  const input = leadActivityListSchema.parse(raw);
  const pattern = input.search ? `%${input.search.replace(/[\\%_]/g, '\\$&')}%` : null;
  const where = and(
    alive,
    isNull(organizations.deletedAt),
    input.type ? eq(leadActivities.type, input.type) : undefined,
    input.productId ? eq(leadActivities.productId, input.productId) : undefined,
    input.from ? gte(leadActivities.createdAt, startOfDay(input.from)) : undefined,
    input.to
      ? lt(leadActivities.createdAt, sql`${startOfDay(input.to)} + interval '1 day'`)
      : undefined,
    pattern
      ? sql`(unaccent(${organizations.name}) ilike unaccent(${pattern})
          or ${leadActivities.email} ilike ${pattern}
          or unaccent(${contactFullName}) ilike unaccent(${pattern}))`
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
      .innerJoin(organizations, eq(organizations.id, leadActivities.organizationId))
      .leftJoin(contacts, eq(contacts.id, leadActivities.contactId))
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

export async function deleteLeadActivity(db: Db, id: string) {
  const [row] = await db
    .update(leadActivities)
    .set({ deletedAt: new Date() })
    .where(and(eq(leadActivities.id, id), alive))
    .returning({
      id: leadActivities.id,
      type: leadActivities.type,
      productId: leadActivities.productId,
    });
  if (!row) throw new LeadActivityError('NOT_FOUND');
  return row;
}

/** Who a token speaks for: a message that really left, to a live organization, and a product. */
async function targetOf(db: Db, env: Env, token: string) {
  const read = readInterestToken(env, token);
  if (!read) return null;
  const [row] = await db
    .select({
      messageId: campaignMessages.id,
      organizationId: campaignMessages.organizationId,
      contactId: campaignMessages.contactId,
      email: campaignMessages.toEmail,
      subject: campaignMessages.subject,
      senderUserId: campaigns.senderUserId,
      productId: products.id,
      productName: products.name,
    })
    .from(campaignMessages)
    .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
    .innerJoin(organizations, eq(organizations.id, campaignMessages.organizationId))
    .innerJoin(products, eq(products.id, read.productId))
    .where(
      and(
        eq(campaignMessages.id, read.messageId),
        inArray(campaignMessages.status, ['sent', 'delivered']),
        isNull(organizations.deletedAt),
      ),
    );
  return row?.organizationId ? { ...row, organizationId: row.organizationId } : null;
}

type Target = NonNullable<Awaited<ReturnType<typeof targetOf>>>;

const sameInterest = (target: Target) =>
  and(
    eq(leadActivities.type, 'product_interest'),
    eq(leadActivities.organizationId, target.organizationId),
    target.contactId
      ? eq(leadActivities.contactId, target.contactId)
      : isNull(leadActivities.contactId),
    eq(leadActivities.productId, target.productId),
    alive,
  );

/**
 * What the public page shows before anything happens. Opening it records nothing: a mail scanner
 * opens links too (docs/activities.md, A-1).
 */
export async function interestInfo(db: Db, env: Env, token: string) {
  const target = await targetOf(db, env, token);
  if (!target) return null;
  const look = await lookFor(db, target.productId);
  return {
    email: maskEmail(target.email),
    product: target.productName,
    brand: look.brandName,
    contact: look.footerEmail || look.replyToAddress || null,
  };
}

/**
 * The confirm button: the first confirmation makes the entry and tells whoever sent the e-mail,
 * a further one only moves `lastConfirmedAt` and adds to the count.
 */
export async function confirmInterest(db: Db, env: Env, token: string) {
  const target = await targetOf(db, env, token);
  if (!target) return null;
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(leadActivities)
      .values({
        type: 'product_interest',
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
        .where(sameInterest(target));
    }
    return { ...target, repeated: !created };
  });
}
