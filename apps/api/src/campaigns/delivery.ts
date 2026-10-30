import type { EmailLook } from '@intra/shared/schemas';
import { Logger } from '@nestjs/common';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { Db } from '../db/db.module.js';
import {
  campaignMessages,
  campaigns,
  contacts,
  emailEvents,
  files,
  fileVersions,
  fullNameOf,
  messageAttachments,
  users,
} from '../db/schema/index.js';
import { getLook, lookFor } from '../email/templates.service.js';
import { replyAddress, replyToken } from '../inbound/inbound.js';
import { describeError } from '../logging/describe-error.js';
import { notify } from '../notifications/notifications.service.js';
import { MailProviderError, type MailTransport } from '../mail/transport.js';
import type { Storage } from '../storage/storage.js';
import { settleCampaigns, tokenHash, unsubscribeToken } from './campaigns.service.js';
import { directAddresses } from './direct.service.js';

const logger = new Logger('campaign-sender');

/**
 * The Reply-To of an e-mail to a customer (Settings › Vzhľad e-mailov): the message's own
 * address back to Intra, which exists only with an inbound domain (else the sender's mailbox,
 * as before it), the company address, or the sender's mailbox.
 */
export function replyToFor(
  look: Pick<EmailLook, 'replyMode' | 'replyToAddress'>,
  inboundReplyTo: string | null,
  senderEmail: string,
) {
  if (look.replyMode === 'company') return look.replyToAddress;
  if (look.replyMode === 'intra') return inboundReplyTo ?? senderEmail;
  return senderEmail;
}

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
  for (const id of ids) {
    if (signal?.aborted) break;
    const [m] = await db
      .select({
        id: campaignMessages.id,
        campaignId: campaignMessages.campaignId,
        kind: campaigns.kind,
        lookProductId: campaigns.lookProductId,
        to: campaignMessages.toEmail,
        subject: campaignMessages.subject,
        html: campaignMessages.html,
        text: campaignMessages.text,
        attempts: campaignMessages.attempts,
        senderName: fullNameOf(users),
        senderEmail: users.email,
        // An answer from the app: the e-mail it answers, to thread it in the customer's client.
        answers: sql<{ messageId: string | null; references: string | null } | null>`(
          select json_build_object('messageId', i.header_message_id, 'references', i.references)
          from inbound_messages i where i.id = ${campaignMessages.inReplyToInboundId})`,
      })
      .from(campaignMessages)
      .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
      .innerJoin(users, eq(users.id, campaigns.senderUserId))
      .where(and(eq(campaignMessages.id, id), eq(campaignMessages.status, 'queued')));
    if (!m?.to || !m.html || !m.subject) continue;
    const look = await lookFor(db, m.lookProductId);
    try {
      const attached = await db
        .select({ key: fileVersions.storageKey, mime: fileVersions.mime, name: files.name })
        .from(messageAttachments)
        .innerJoin(fileVersions, eq(fileVersions.id, messageAttachments.fileVersionId))
        .innerJoin(files, eq(files.id, fileVersions.fileId))
        .where(and(eq(messageAttachments.messageId, id), eq(messageAttachments.asLink, false)))
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
      const inboundReplyTo = look.replyMode === 'intra' ? replyAddress(env, id) : null;
      const replyTo = replyToFor(look, inboundReplyTo, m.senderEmail);
      const direct = m.kind === 'direct';
      const sent = await transport.send(
        {
          to: m.to,
          ...(direct ? await directAddresses(db, m.campaignId) : {}),
          subject: m.subject,
          html: m.html,
          text: m.text ?? '',
          from: `${m.senderName} | ${look.brandName} <${env.CAMPAIGN_FROM_ADDRESS}>`,
          replyTo,
          headers: direct
            ? {}
            : m.answers
              ? {
                  // Correspondence (D-14): threaded, without an unsubscribe link.
                  ...(m.answers.messageId
                    ? {
                        'In-Reply-To': m.answers.messageId,
                        References: [m.answers.references, m.answers.messageId]
                          .filter(Boolean)
                          .join(' '),
                      }
                    : {}),
                }
              : {
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
                replyToken: inboundReplyTo ? replyToken(env, id) : null,
                leasedUntil: null,
              },
        )
        .where(eq(campaignMessages.id, id));
      // The other recipients of a direct e-mail: it went to them in this one send.
      if (direct) {
        await db
          .update(campaignMessages)
          .set(
            sent.skipped
              ? { status: 'skipped', skipReason: 'reserved' }
              : { status: 'sent', sentAt: new Date() },
          )
          .where(
            and(
              eq(campaignMessages.campaignId, m.campaignId),
              eq(campaignMessages.status, 'queued'),
            ),
          );
      }
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
      if (giveUp && m.kind === 'direct') {
        await db
          .update(campaignMessages)
          .set({ status: 'failed', errorCode: code })
          .where(
            and(
              eq(campaignMessages.campaignId, m.campaignId),
              eq(campaignMessages.status, 'queued'),
            ),
          );
      }
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
      customerId: campaignMessages.organizationId,
      campaignId: campaignMessages.campaignId,
      subject: campaignMessages.subject,
      senderUserId: campaigns.senderUserId,
    })
    .from(campaignMessages)
    .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
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
    // The sender hears of an e-mail that did not arrive, once: when it first turns „bounced“.
    if (next === 'bounced') {
      await notify(db, {
        userId: message.senderUserId,
        kind: 'bounce',
        refId: message.campaignId,
        customerId: message.customerId,
        subject: message.subject?.slice(0, 200) ?? null,
      });
    }
  }
  if (next === 'bounced' || next === 'complained') {
    const emailStatus = next === 'bounced' ? 'bounced' : 'complained';
    // Every e-mail names its person since stage O2 (a private person included).
    if (message.contactId) {
      await db.update(contacts).set({ emailStatus }).where(eq(contacts.id, message.contactId));
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
      customerId: campaignMessages.organizationId,
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
    : [];
  return {
    email: maskEmail(row.toEmail),
    unsubscribed: state?.unsubscribedAt !== null && state?.unsubscribedAt !== undefined,
    brand: (await getLook(db)).brandName,
  };
}

/**
 * Unsubscribes the person the message went to (or brings them back). A colleague's „manual“
 * switch is not undone by the link.
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
  }
  // Only bulk e-mails carry an unsubscribe token, and their recipients have an organization.
  return { customerId: row.customerId!, contactId: row.contactId };
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
        // A direct e-mail is correspondence: it goes anyway.
        isNull(campaignMessages.recipientRole),
        recipient.contactId
          ? eq(campaignMessages.contactId, recipient.contactId)
          : and(
              eq(campaignMessages.organizationId, recipient.customerId),
              isNull(campaignMessages.contactId),
            ),
      ),
    );
}
