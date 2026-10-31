import { createHmac, timingSafeEqual } from 'node:crypto';
import { ACTIVITY_TYPE_FEEDBACK_ID, ADOS_PRODUCT_ID } from '@intra/shared/schemas';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/db.module.js';
import {
  appFeedback,
  appFeedbackEvents,
  contacts,
  leadActivities,
  organizations,
  products,
} from '../db/schema/index.js';
import type { Storage } from '../storage/storage.js';

/** The contract's limit: 400 KB of bytes in base64. */
const MAX_SCREENSHOT_CHARS = 546_136;
const MAX_AGE_SECONDS = 300;

/**
 * Alma's signature on the exact bytes it sent: `sha256=` + HMAC-SHA256 of `timestamp.body`, at most
 * five minutes off (`pilot-feedback-intranet.md` in alma-ados).
 */
export function verifyAlmaSignature(
  secret: string,
  headers: { timestamp: string | undefined; signature: string | undefined },
  rawBody: Buffer,
  nowSeconds = Date.now() / 1000,
) {
  const timestamp = headers.timestamp ?? '';
  const match = /^sha256=([0-9a-f]{64})$/.exec(headers.signature ?? '');
  if (!/^\d+$/.test(timestamp) || !match) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(match[1]!, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const time = z.string().datetime({ offset: true });
const text = (max: number) => z.string().max(max);

/** Read leniently: Alma may add fields, and refusing an item only makes it retry for a day. */
export const feedbackItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: time,
  type: text(40),
  whatDoing: text(4000).min(1),
  expected: text(4000).default(''),
  reporter: z.object({
    userId: z.string().uuid().nullish(),
    name: text(300),
    email: text(320),
    role: text(40).nullish(),
  }),
  /** Intra's id once ADOS has adapted, until then ADOS's (docs/integrations/products.md). */
  organization: z.object({ id: z.string().uuid(), name: text(300).nullish() }),
  app: z.record(z.unknown()),
  device: z.record(z.unknown()),
  place: z.record(z.unknown()).nullish(),
  trail: z.array(z.unknown()).max(30).default([]),
  apiCalls: z.array(z.unknown()).max(30).default([]),
  errors: z.array(z.unknown()).max(30).default([]),
  pendingSync: z.number().int().nullish(),
  screenshot: z
    .object({
      contentType: z.literal('image/jpeg'),
      dataBase64: z.string().max(MAX_SCREENSHOT_CHARS),
    })
    .nullish(),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

export const feedbackMessageSchema = z.object({
  id: z.string().uuid(),
  feedbackId: z.string().uuid(),
  createdAt: time,
  body: text(4000).min(1),
  statusAfter: text(40).nullish(),
});

export const feedbackConfirmationSchema = z.object({
  id: z.string().uuid(),
  feedbackId: z.string().uuid(),
  createdAt: time,
  works: z.boolean(),
  body: text(4000).min(1).nullish(),
  statusAfter: text(40).nullish(),
  resolvedEventId: text(100).nullish(),
});

/** Intra's id first; `alma_organization_id` only until ADOS sends Intra's. */
async function organizationFor(db: Db, id: string) {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        isNull(organizations.deletedAt),
        or(eq(organizations.id, id), eq(organizations.almaOrganizationId, id)),
      ),
    )
    .orderBy(desc(sql`${organizations.id} = ${id}`))
    .limit(1);
  return row?.id ?? null;
}

/** An e-mail belongs to one live contact (D-7). */
async function contactFor(db: Db, email: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(isNull(contacts.deletedAt), sql`lower(${contacts.email}) = lower(${email})`))
    .limit(1);
  return row?.id ?? null;
}

const JPEG_START = Buffer.from([0xff, 0xd8]);

/** The masked picture, under ids only. Written again by a retry: the same key, the same bytes. */
async function storeScreenshot(storage: Storage | null, item: FeedbackItem) {
  if (!storage || !item.screenshot) return null;
  const bytes = Buffer.from(item.screenshot.dataBase64, 'base64');
  if (!bytes.subarray(0, 2).equals(JPEG_START)) return null;
  const key = `feedback/${item.id}/screen.jpg`;
  await storage.put(key, bytes, 'image/jpeg');
  return key;
}

/**
 * Request 1: a new item, once per `id`, and its entry in Aktivity. Stored even without a match:
 * Alma gives up after a day, and a lost podnet cannot be got back. The product comes from the
 * endpoint: only Alma ADOS calls it.
 */
export async function receiveFeedback(db: Db, storage: Storage | null, item: FeedbackItem) {
  const [known] = await db
    .select({ id: appFeedback.id })
    .from(appFeedback)
    .where(eq(appFeedback.id, item.id));
  if (known) return null;
  const screenshotKey = await storeScreenshot(storage, item);
  const [organizationId, contactId, [product]] = await Promise.all([
    organizationFor(db, item.organization.id),
    contactFor(db, item.reporter.email),
    db.select({ id: products.id }).from(products).where(eq(products.id, ADOS_PRODUCT_ID)),
  ]);
  const sentAt = new Date(item.createdAt);
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(appFeedback)
      .values({
        id: item.id,
        kind: item.type,
        whatDoing: item.whatDoing,
        expected: item.expected,
        reporterUserId: item.reporter.userId ?? null,
        reporterName: item.reporter.name,
        reporterEmail: item.reporter.email,
        reporterRole: item.reporter.role ?? null,
        sourceOrganizationId: item.organization.id,
        sourceOrganizationName: item.organization.name ?? null,
        app: item.app,
        device: item.device,
        place: item.place ?? null,
        trail: item.trail,
        apiCalls: item.apiCalls,
        errors: item.errors,
        pendingSync: item.pendingSync ?? null,
        screenshotKey,
        sentAt,
      })
      .onConflictDoNothing()
      .returning({ id: appFeedback.id });
    if (!stored) return null;
    const [entry] = await tx
      .insert(leadActivities)
      .values({
        typeId: ACTIVITY_TYPE_FEEDBACK_ID,
        source: 'app',
        productId: product?.id ?? null,
        organizationId,
        contactId,
        appFeedbackId: stored.id,
        email: item.reporter.email,
        createdAt: sentAt,
        lastConfirmedAt: sentAt,
      })
      .returning({ id: leadActivities.id });
    return {
      id: entry!.id,
      productId: product?.id ?? null,
      organizationId,
      contactId,
    };
  });
}

/**
 * Requests 2 and 2b: what the reporter added, kept for the way back, which comes in a later step.
 * `false`: the item is unknown, and Alma tries again.
 */
export async function receiveFeedbackEvent(
  db: Db,
  feedbackId: string,
  event: {
    id: string;
    kind: 'message' | 'confirmation';
    createdAt: string;
    body?: string | null | undefined;
    works?: boolean | undefined;
    statusAfter?: string | null | undefined;
    resolvedEventId?: string | null | undefined;
  },
) {
  const [item] = await db
    .select({ id: appFeedback.id })
    .from(appFeedback)
    .where(eq(appFeedback.id, feedbackId));
  if (!item) return false;
  await db
    .insert(appFeedbackEvents)
    .values({
      id: event.id,
      feedbackId,
      kind: event.kind,
      body: event.body ?? null,
      works: event.works ?? null,
      statusAfter: event.statusAfter ?? null,
      resolvedEventId: event.resolvedEventId ?? null,
      sentAt: new Date(event.createdAt),
    })
    .onConflictDoNothing();
  return true;
}
