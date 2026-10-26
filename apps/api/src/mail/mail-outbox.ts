import { Logger } from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  discardAuthToken,
  INVITATION_TTL_MS,
  issueAuthToken,
  PASSWORD_RESET_TTL_MS,
  supersedeAuthTokens,
  supersedeKey,
} from '../auth/account.service.js';
import type { Db, Tx } from '../db/db.module.js';
import { mailOutbox, type SecondFactorChange, users } from '../db/schema/index.js';
import { describeError } from '../logging/describe-error.js';
import type { Mailer, SentMail } from './mailer.js';
import { MailProviderError } from './transport.js';

/** What a procedure asks for. Ids only, see `mailOutbox`. */
export type MailJob =
  | { kind: 'invitation'; userId: string }
  | { kind: 'password_reset'; userId: string }
  | { kind: 'second_factor_changed'; userId: string; change: SecondFactorChange };

/**
 * 1 min, 2 min, 4 min … about two hours in total, then the row is marked failed. A permanent
 * refusal of the provider is marked failed at its first attempt (`MailProviderError.permanent`).
 */
export const MAX_ATTEMPTS = 8;
/** Hard limit for one provider call. The first lease (1 min) is comfortably longer. */
export const SEND_TIMEOUT_MS = 15_000;
const RETENTION_DAYS = 30;

const logger = new Logger('mail-outbox');

/**
 * Queues an e-mail in the caller's transaction: it is delivered only if that transaction commits,
 * and the request never waits for the mail provider. Asking again while the same mail is still
 * undelivered adds nothing (`mail_outbox_pending_unique`), and the answer is `false`: the mail
 * already on its way is the one that will arrive.
 */
export async function enqueueMail(db: Db | Tx, job: MailJob): Promise<boolean> {
  const { kind, ...payload } = job;
  const queued = await db
    .insert(mailOutbox)
    .values({ kind, payload })
    .onConflictDoNothing({
      target: [mailOutbox.kind, mailOutbox.payload],
      where: sql`sent_at is null and failed_at is null and dropped_at is null`,
    })
    .returning({ id: mailOutbox.id });
  return queued.length > 0;
}

/**
 * A queued invitation that must not go out any more (the invitation was withdrawn). The worker
 * would drop it anyway when it finds the user no longer `invited`; dropping it here keeps a later
 * re-invitation from riding on a stale row.
 */
export async function dropQueuedInvitation(db: Db | Tx, userId: string): Promise<void> {
  await db
    .update(mailOutbox)
    .set({ droppedAt: sql`now()` })
    .where(
      and(
        eq(mailOutbox.kind, 'invitation'),
        sql`${mailOutbox.payload} ->> 'userId' = ${userId}`,
        isNull(mailOutbox.sentAt),
        isNull(mailOutbox.failedAt),
        isNull(mailOutbox.droppedAt),
      ),
    );
}

/** How the latest invitation mail of a user fared. */
export type InvitationDelivery = 'sent' | 'pending' | 'retrying' | 'failed';

/**
 * As a column of a query over `users`: `pending` while the latest invitation mail waits for its
 * first attempt, `retrying` once an attempt failed and the worker will try again, `failed` once
 * the worker gave up on it, `sent` once the provider took it. `null` for a user who is not
 * `invited` any more, for a dropped mail and when no row is left (purged after 30 days). A status
 * and nothing else: never the error code, never the address.
 */
export const invitationDelivery = sql<InvitationDelivery | null>`case
  when "users"."status" = 'invited' then (
    select case
      when o.sent_at is not null then 'sent'
      when o.failed_at is not null then 'failed'
      when o.dropped_at is not null then null
      when o.last_error is not null then 'retrying'
      else 'pending'
    end
    from mail_outbox o
    where o.kind = 'invitation'
      and o.payload ->> 'userId' = "users"."id"::text
    order by o.created_at desc, o.id desc
    limit 1
  )
end`;

type Claimed = { id: string; attempts: number } & MailJob;

/**
 * Claims the oldest due row. Pushing `next_attempt_at` forward is both the lease and the retry
 * schedule, so no transaction stays open while the provider is called; `SKIP LOCKED` keeps two API
 * instances from claiming the same row.
 */
async function claim(db: Db): Promise<Claimed | null> {
  const { rows } = await db.execute<{
    id: string;
    kind: MailJob['kind'];
    payload: Record<string, string>;
    attempts: number;
  }>(sql`
    update mail_outbox
    set attempts = attempts + 1,
        next_attempt_at = now() + interval '1 minute' * power(2, attempts)
    where id = (
      select id from mail_outbox
      where sent_at is null and failed_at is null and dropped_at is null
        and next_attempt_at <= now()
      order by next_attempt_at
      limit 1
      for update skip locked
    )
    returning id, kind, payload, attempts`);
  const row = rows[0];
  return row
    ? ({ id: row.id, attempts: row.attempts, kind: row.kind, ...row.payload } as Claimed)
    : null;
}

class MailTimeoutError extends Error {
  override readonly name = 'MailTimeoutError';
  constructor() {
    super('E-mail provider timed out');
  }
}

/** The provider SDK takes no AbortSignal, so the wait is what gets cut off. */
async function withinTimeout(send: Promise<SentMail>): Promise<SentMail> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailTimeoutError()), SEND_TIMEOUT_MS);
  });
  try {
    return await Promise.race([send, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `eva.novakova@example.com` as `e***@example.com`: enough to tell which address a mail went to
 * and to see a domain that bounces, not enough to write to it.
 */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

/** What `last_error` keeps: a code, never a message (see `mailOutbox.lastError`). */
export function deliveryErrorCode(error: unknown): string {
  if (error instanceof MailProviderError) return `provider:${error.providerCode}`.slice(0, 100);
  if (error instanceof MailTimeoutError) return 'timeout';
  const { names, pgCode } = describeError(error);
  return [names.join('<') || 'unknown', pgCode].filter(Boolean).join(' ').slice(0, 100);
}

/** Where a mail went and what the provider answered; `null` when there was nothing to send. */
type Delivered = { to: string } & SentMail;

/**
 * Sends a mail with a fresh one-time link. The token is inserted next to the ones already out, and
 * only a successful send makes it the only valid one; a failed send removes it again. So a provider
 * outage never kills a link the recipient already holds, and retries leave nothing behind. The raw
 * token is never stored, and its validity starts when the mail really goes out.
 */
async function sendWithToken(
  db: Db,
  input: Parameters<typeof issueAuthToken>[1],
  send: (token: string) => Promise<SentMail>,
): Promise<SentMail> {
  const issued = await issueAuthToken(db, input);
  let sent: SentMail;
  try {
    sent = await withinTimeout(send(issued.token));
  } catch (error) {
    await discardAuthToken(db, issued.id);
    throw error;
  }
  // A skipped mail carried its link nowhere: like a failed send, it leaves no token behind.
  if (sent.skipped) await discardAuthToken(db, issued.id);
  else await supersedeAuthTokens(db, supersedeKey(issued.id, input));
  return sent;
}

/**
 * Looks up the recipient (the ids come from our own outbox row, never from a client) and sends.
 * Returns `null` when there is nothing to send any more.
 */
async function deliver(db: Db, mailer: Mailer, job: Claimed): Promise<Delivered | null> {
  // A new key per attempt: every attempt carries a new link, and the provider refuses a repeated
  // key with a different body. It covers repeats of one attempt, not the at-least-once retry.
  const idempotencyKey = `mail-outbox/${job.id}/${job.attempts}`;

  if (job.kind === 'second_factor_changed') {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, job.userId), isNull(users.deletedAt)));
    if (!user) return null;
    return {
      to: user.email,
      ...(await withinTimeout(
        mailer.sendSecondFactorChanged(user.email, job.change, idempotencyKey),
      )),
    };
  }

  if (job.kind === 'password_reset') {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          eq(users.id, job.userId),
          eq(users.status, 'active'),
          isNull(users.deletedAt),
          isNotNull(users.passwordHash),
        ),
      );
    if (!user) return null;
    return {
      to: user.email,
      ...(await sendWithToken(
        db,
        { type: 'password_reset', userId: job.userId, ttlMs: PASSWORD_RESET_TTL_MS },
        (token) => mailer.sendPasswordReset(user.email, token, idempotencyKey),
      )),
    };
  }

  // An invitation goes only while the user is still invited: one withdrawn or accepted meanwhile
  // gets nothing.
  const inviter = alias(users, 'inviter');
  const [invited] = await db
    .select({ email: users.email, invitedByName: inviter.name })
    .from(users)
    .leftJoin(inviter, eq(inviter.id, users.invitedByUserId))
    .where(and(eq(users.id, job.userId), eq(users.status, 'invited'), isNull(users.deletedAt)));
  if (!invited) return null;
  const sent = await sendWithToken(
    db,
    { type: 'invitation', userId: job.userId, ttlMs: INVITATION_TTL_MS },
    (token) =>
      mailer.sendInvitation(
        invited.email,
        token,
        { invitedByName: invited.invitedByName },
        idempotencyKey,
      ),
  );
  return { to: invited.email, ...sent };
}

/**
 * Delivers what is due and returns the ids by outcome. The worker calls this on a timer; tests call
 * it directly instead of sleeping. `stop` is checked before every claim, so a shutdown ends after
 * the delivery in flight. Delivery is at-least-once: a crash between the provider call and
 * `sent_at` repeats the mail, and the newer link replaces the older one.
 */
export async function drainMailOutbox(db: Db, mailer: Mailer, stop?: AbortSignal) {
  const outcome = {
    sent: [] as string[],
    retry: [] as string[],
    dropped: [] as string[],
    skipped: [] as string[],
    failed: [] as string[],
  };
  while (!stop?.aborted) {
    const job = await claim(db);
    if (!job) break;
    const mark = (
      column: 'sentAt' | 'droppedAt' | 'failedAt' | null,
      log: Partial<
        Pick<typeof mailOutbox.$inferInsert, 'recipientMasked' | 'providerMessageId' | 'lastError'>
      > = {},
    ) =>
      db
        .update(mailOutbox)
        .set({ ...(column ? { [column]: sql`now()` } : {}), ...log })
        .where(eq(mailOutbox.id, job.id));
    try {
      const delivered = await deliver(db, mailer, job);
      if (delivered?.skipped) {
        // A reserved domain: dropped, not failed, and the masked address says why.
        await mark('droppedAt', { recipientMasked: maskAddress(delivered.to) });
        outcome.skipped.push(job.id);
        logger.log({ msg: 'mail skipped, reserved domain', mailId: job.id, kind: job.kind });
      } else if (delivered) {
        await mark('sentAt', {
          recipientMasked: maskAddress(delivered.to),
          providerMessageId: delivered.providerMessageId,
        });
        outcome.sent.push(job.id);
        logger.log({ msg: 'mail sent', mailId: job.id, kind: job.kind });
      } else {
        // Expected: the invitation was accepted or withdrawn meanwhile, the account is gone.
        await mark('droppedAt');
        outcome.dropped.push(job.id);
        logger.log({
          msg: 'mail dropped, nothing to send any more',
          mailId: job.id,
          kind: job.kind,
        });
      }
    } catch (error) {
      // Ids and error names only: the message of a failed query or provider call may hold an address.
      // A permanent refusal is given up on at once, not after two hours of asking again.
      const permanent = error instanceof MailProviderError && error.permanent;
      const gaveUp = permanent || job.attempts >= MAX_ATTEMPTS;
      logger.error({
        msg: gaveUp ? 'mail delivery failed, giving up' : 'mail delivery failed, will retry',
        mailId: job.id,
        kind: job.kind,
        attempt: job.attempts,
        permanent,
        ...describeError(error),
      });
      await mark(gaveUp ? 'failedAt' : null, { lastError: deliveryErrorCode(error) });
      (gaveUp ? outcome.failed : outcome.retry).push(job.id);
    }
  }
  return outcome;
}

/** Retention: finished rows hold ids only, but there is no reason to keep them for ever. */
export async function purgeMailOutbox(db: Db): Promise<void> {
  await db.execute(sql`
    delete from mail_outbox
    where coalesce(sent_at, failed_at, dropped_at) < now() - make_interval(days => ${RETENTION_DAYS})`);
}
