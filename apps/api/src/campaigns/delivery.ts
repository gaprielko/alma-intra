import { Logger } from '@nestjs/common';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { Db } from '../db/db.module.js';
import {
  campaignMessages,
  campaigns,
  contacts,
  customers,
  emailEvents,
  files,
  fileVersions,
  messageAttachments,
  users,
} from '../db/schema/index.js';
import { getLook } from '../email/templates.service.js';
import { replyAddress, replyToken } from '../inbound/inbound.js';
import { describeError } from '../logging/describe-error.js';
import { MailProviderError, type MailTransport } from '../mail/transport.js';
import type { Storage } from '../storage/storage.js';
import { settleCampaigns, tokenHash, unsubscribeToken } from './campaigns.service.js';

const logger = new Logger('campaign-sender');

/** 1, 2, 4, 8, 16 minutes; then the message is failed. A permanent refusal fails it at once. */
export const MAX_ATTEMPTS = 6;
/** A claimed message is the worker's for this long; a crash leaves it to the next run after. */
const LEASE_MS = 5 * 60_000;
/** Resend allows 2 requests a second on a default plan: one every 600 ms stays under it. */
const SEND_GAP_MS = 600;
const BATCH = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Claims the queued messages due now; another instance skips the ones claimed here. */
async function claim(db: Db) {
  const now = new Date();
  const result = await db.execute<{ id: string }>(sql`
    update campaign_messages set leased_until = ${new Date(now.getTime() + LEASE_MS)},
      attempts = attempts + 1
    where id in (
      select id from campaign_messages
      where status = 'queued' and next_attempt_at <= ${now}
        and (leased_until is null or leased_until < ${now})
      order by next_attempt_at
      limit ${BATCH}
      for update skip locked
    )
    returning id`);
  return result.rows.map((row) => row.id);
}

/**
 * Sends what is due, one message after another within Resend's rate limit. Each message keeps its
 * idempotency key across attempts (`campaign-message/<id>`): a retry after a timeout never makes a
 * second e-mail. The attachments travel as short-lived signed links Resend fetches.
 */
export async function drainCampaigns(
  db: Db,
  transport: MailTransport,
  storage: Storage | null,
  env: Env,
  signal?: AbortSignal,
) {
  const ids = await claim(db);
  if (ids.length === 0) return 0;
  const look = await getLook(db);
  for (const id of ids) {
    if (signal?.aborted) break;
    const [m] = await db
      .select({
        id: campaignMessages.id,
        to: campaignMessages.toEmail,
        subject: campaignMessages.subject,
        html: campaignMessages.html,
        text: campaignMessages.text,
        attempts: campaignMessages.attempts,
        senderName: users.name,
        senderEmail: users.email,
      })
      .from(campaignMessages)
      .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
      .innerJoin(users, eq(users.id, campaigns.senderUserId))
      .where(and(eq(campaignMessages.id, id), eq(campaignMessages.status, 'queued')));
    if (!m?.to || !m.html || !m.subject) continue;
    try {
      const attached = await db
        .select({ key: fileVersions.storageKey, mime: fileVersions.mime, name: files.name })
        .from(messageAttachments)
        .innerJoin(fileVersions, eq(fileVersions.id, messageAttachments.fileVersionId))
        .innerJoin(files, eq(files.id, fileVersions.fileId))
        .where(eq(messageAttachments.messageId, id))
        .orderBy(asc(messageAttachments.position));
      if (attached.length > 0 && !storage) throw new MailProviderError('storage_not_configured');
      const attachments = await Promise.all(
        attached.map(async (a) => ({
          filename: a.name,
          path: (
            await storage!.createDownloadUrl(a.key, {
              fileName: a.name,
              contentType: a.mime,
              inline: false,
            })
          ).url,
        })),
      );
      const oneClick = `${env.WEB_URL}/u/${unsubscribeToken(env, id)}`;
      // The reply comes back to Intra when an inbound domain is set, else to the sender's mailbox.
      const replyTo = replyAddress(env, id);
      const sent = await transport.send(
        {
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text ?? '',
          from: `${m.senderName} | ${look.brandName} <${env.CAMPAIGN_FROM_ADDRESS}>`,
          replyTo: replyTo ?? m.senderEmail,
          headers: {
            'List-Unsubscribe': `<${oneClick}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          ...(attachments.length > 0 ? { attachments } : {}),
        },
        `campaign-message/${id}`,
      );
      await db
        .update(campaignMessages)
        .set(
          sent.skipped
            ? { status: 'skipped', skipReason: 'reserved', leasedUntil: null }
            : {
                status: 'sent',
                sentAt: new Date(),
                providerMessageId: sent.providerMessageId,
                replyToken: replyTo ? replyToken(env, id) : null,
                leasedUntil: null,
              },
        )
        .where(eq(campaignMessages.id, id));
    } catch (error) {
      const permanent = error instanceof MailProviderError && error.permanent;
      const code = error instanceof MailProviderError ? `provider:${error.providerCode}` : 'error';
      const giveUp = permanent || m.attempts >= MAX_ATTEMPTS;
      await db
        .update(campaignMessages)
        .set(
          giveUp
            ? { status: 'failed', errorCode: code, leasedUntil: null }
            : {
                errorCode: code,
                leasedUntil: null,
                nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** (m.attempts - 1)),
              },
        )
        .where(eq(campaignMessages.id, id));
      logger.warn({
        msg: 'campaign message not sent',
        messageId: id,
        giveUp,
        ...describeError(error),
      });
    }
    await sleep(SEND_GAP_MS);
  }
  await settleCampaigns(db);
  return ids.length;
}

// ---------------------------------------------------------------------------------------------
// Resend webhooks

/**
 * Resend signs its webhooks the Svix way: `svix-id`, `svix-timestamp` and `svix-signature`
 * (`v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">`, several separated by spaces), with the
 * secret `whsec_<base64>`. A timestamp more than 5 minutes off is refused (replays).
 */
export function verifyWebhook(
  secret: string,
  headers: {
    id?: string | undefined;
    timestamp?: string | undefined;
    signature?: string | undefined;
  },
  body: Buffer,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body.toString('utf8')}`)
    .digest();
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; bounce?: { type?: string; subType?: string } };
}

/** Which state an event brings; a later state is never overwritten by an earlier one. */
const RANK = { queued: 0, sent: 1, delivered: 2, bounced: 3, complained: 4 } as const;

/**
 * One webhook event: kept (once, by its Svix id), and the message's state moved on. A hard bounce
 * marks the address bad, a complaint marks it so too: neither gets marketing mail again.
 */
export async function handleResendEvent(db: Db, eventId: string, event: ResendEvent) {
  const providerId = event.data?.email_id;
  if (!providerId || !event.type) return { ignored: true };
  const [message] = await db
    .select({
      id: campaignMessages.id,
      status: campaignMessages.status,
      contactId: campaignMessages.contactId,
      customerId: campaignMessages.customerId,
    })
    .from(campaignMessages)
    .where(eq(campaignMessages.providerMessageId, providerId));
  const at = event.created_at ? new Date(event.created_at) : new Date();
  const kind = event.type.replace(/^email\./, '');
  const detail = event.data?.bounce?.type ?? null;
  const inserted = await db
    .insert(emailEvents)
    .values({
      messageId: message?.id ?? null,
      providerEventId: eventId,
      type: kind,
      detail,
      occurredAt: at,
    })
    .onConflictDoNothing()
    .returning({ id: emailEvents.id });
  if (!message || inserted.length === 0) return { ignored: !message };

  const next =
    kind === 'delivered'
      ? 'delivered'
      : kind === 'bounced' && detail !== 'Transient'
        ? 'bounced'
        : kind === 'complained'
          ? 'complained'
          : null;
  const current = RANK[message.status as keyof typeof RANK] ?? 0;
  if (next && RANK[next] > current) {
    await db
      .update(campaignMessages)
      .set({
        status: next,
        ...(next === 'delivered' ? { deliveredAt: at } : {}),
        ...(next === 'bounced' ? { bouncedAt: at } : {}),
        ...(next === 'complained' ? { complainedAt: at } : {}),
      })
      .where(eq(campaignMessages.id, message.id));
  }
  if (next === 'bounced' || next === 'complained') {
    const emailStatus = next === 'bounced' ? 'bounced' : 'complained';
    if (message.contactId) {
      await db.update(contacts).set({ emailStatus }).where(eq(contacts.id, message.contactId));
    } else {
      await db.update(customers).set({ emailStatus }).where(eq(customers.id, message.customerId));
    }
  }
  return { ignored: false, messageId: message.id, status: next };
}

// ---------------------------------------------------------------------------------------------
// Unsubscribe

/** The message a token belongs to, with the address it went to. */
async function byToken(db: Db, token: string) {
  const [row] = await db
    .select({
      id: campaignMessages.id,
      contactId: campaignMessages.contactId,
      customerId: campaignMessages.customerId,
      toEmail: campaignMessages.toEmail,
    })
    .from(campaignMessages)
    .where(eq(campaignMessages.unsubscribeTokenHash, tokenHash(token)));
  return row ?? null;
}

/** `e***@adosharmonia.sk`: enough to recognise the address, not enough to harvest it. */
export const maskEmail = (email: string | null) =>
  email ? email.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : '';

/** What the public page shows before anything changes: the masked address and the state. */
export async function unsubscribeInfo(db: Db, token: string) {
  const row = await byToken(db, token);
  if (!row) return null;
  const [state] = row.contactId
    ? await db
        .select({ unsubscribedAt: contacts.unsubscribedAt })
        .from(contacts)
        .where(eq(contacts.id, row.contactId))
    : await db
        .select({ unsubscribedAt: customers.unsubscribedAt })
        .from(customers)
        .where(eq(customers.id, row.customerId));
  return {
    email: maskEmail(row.toEmail),
    unsubscribed: state?.unsubscribedAt !== null && state?.unsubscribedAt !== undefined,
    brand: (await getLook(db)).brandName,
  };
}

/**
 * Unsubscribes the recipient of the message (or brings them back): the contact, or the private
 * person. A colleague's „manual“ switch is not undone by the link.
 */
export async function setUnsubscribed(db: Db, token: string, unsubscribed: boolean) {
  const row = await byToken(db, token);
  if (!row) return null;
  const values = unsubscribed
    ? { unsubscribedAt: new Date(), unsubscribeSource: 'link' as const }
    : { unsubscribedAt: null, unsubscribeSource: null };
  if (row.contactId) {
    await db
      .update(contacts)
      .set(values)
      .where(
        and(
          eq(contacts.id, row.contactId),
          unsubscribed
            ? isNull(contacts.unsubscribedAt)
            : or(eq(contacts.unsubscribeSource, 'link'), isNull(contacts.unsubscribeSource)),
        ),
      );
  } else {
    await db
      .update(customers)
      .set(values)
      .where(
        and(
          eq(customers.id, row.customerId),
          unsubscribed
            ? isNull(customers.unsubscribedAt)
            : or(eq(customers.unsubscribeSource, 'link'), isNull(customers.unsubscribeSource)),
        ),
      );
  }
  return { customerId: row.customerId, contactId: row.contactId };
}

/** Queued messages to a recipient who unsubscribed meanwhile do not leave. */
export async function dropForUnsubscribed(
  db: Db,
  recipient: { contactId: string | null; customerId: string },
) {
  await db
    .update(campaignMessages)
    .set({ status: 'skipped', skipReason: 'unsubscribed' })
    .where(
      and(
        eq(campaignMessages.status, 'queued'),
        recipient.contactId
          ? eq(campaignMessages.contactId, recipient.contactId)
          : and(
              eq(campaignMessages.customerId, recipient.customerId),
              isNull(campaignMessages.contactId),
            ),
      ),
    );
}
