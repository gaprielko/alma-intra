import { createHash } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import { rateLimits } from '../db/schema/index.js';

export interface RateLimitRule {
  scope: string;
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;
/** Longer than the longest window below. */
const RETENTION_MS = 120 * MINUTE;

/**
 * Per IP address unless the name says otherwise. Generous for people, tight for scripts. Windows
 * are fixed (aligned to the clock), so a lockout lasts at most one window and a burst across a
 * boundary can reach twice the limit; good enough against guessing, and one row per subject.
 */
export const RATE_LIMITS = {
  loginFailuresPerIp: { scope: 'login-fail:ip', limit: 30, windowMs: 15 * MINUTE },
  /** The failure that reaches the limit also locks the e-mail from then on (`LOGIN_LOCK`). */
  loginFailuresPerEmail: { scope: 'login-fail:email', limit: 10, windowMs: 15 * MINUTE },
  passwordResetPerIp: { scope: 'reset-request:ip', limit: 20, windowMs: 60 * MINUTE },
  passwordResetPerEmail: { scope: 'reset-request:email', limit: 5, windowMs: 60 * MINUTE },
  /**
   * Token rotation costs a transaction, so it is not free to hammer. Generous: the whole office
   * shares one address, and a refused refresh looks like a logout.
   */
  refreshPerIp: { scope: 'refresh:ip', limit: 600, windowMs: 15 * MINUTE },
  oneTimeToken: { scope: 'one-time-token:ip', limit: 30, windowMs: 15 * MINUTE },
  /**
   * Per user: wrong current passwords at a password change or before the second factor changes. A
   * stolen session must not be able to guess the password it would lock the owner out with.
   */
  passwordChangePerUser: { scope: 'password-change:user', limit: 10, windowMs: 15 * MINUTE },
  /**
   * Per user: wrong codes at the second step of a login and at a change of the factor on „Môj
   * účet“. The failure that reaches the limit locks her second step (`SECOND_FACTOR_LOCK`). Its
   * own key, not the login's per-e-mail one: a password reset clears that one, and a mailbox must
   * not buy fresh guesses at the code.
   */
  secondFactorFailuresPerUser: {
    scope: 'second-factor-fail:user',
    limit: 10,
    windowMs: 15 * MINUTE,
  },
  /** Per user: wrong codes while confirming a new authenticator; keeps a loop out of the trail. */
  secondFactorConfirmPerUser: {
    scope: 'second-factor-confirm:user',
    limit: 10,
    windowMs: 15 * MINUTE,
  },
  /** Per user: invitations sent; each one is an e-mail from the company's domain. */
  invitationPerUser: { scope: 'invitation:user', limit: 30, windowMs: 60 * MINUTE },
  /** Per user: how many refusals are written to the audit trail; the refusals themselves go on. */
  deniedAuditPerUser: { scope: 'audit-denied:user', limit: 20, windowMs: 15 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/**
 * The unit an attacker cannot cheaply change: an IPv4 address, or the /64 of an IPv6 address (one
 * host routinely owns a whole /64).
 */
export function ipSubject(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (!isIPv6(ip)) return ip;
  let address = ip.split('%')[0]!;
  // A dotted tail (`::ffff:203.0.113.7`) is the last two groups written as IPv4.
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number) as [number, number, number, number];
    address = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = (
    address.includes('::')
      ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
      : left
  ).map((g) => parseInt(g, 16));
  // IPv4-mapped in any spelling is an IPv4 client; never let them all share the `0:0:0:0` /64.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6]!, groups[7]!];
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

const keyOf = (rule: Pick<RateLimitRule, 'scope'>, subject: string) =>
  createHash('sha256').update(`${rule.scope}:${subject.toLowerCase()}`).digest('hex');

const windowStart = (rule: RateLimitRule, now: number) =>
  new Date(Math.floor(now / rule.windowMs) * rule.windowMs);

export interface Hit {
  count: number;
  /** The window the event was counted in; `refund` must give it back to the same one. */
  windowStart: Date;
}

/**
 * Counts one event and returns the count including it. Count first and decide afterwards: a
 * check followed by a later increment lets parallel requests all pass the check.
 */
/** `db` may be a request's transaction: a refused call then rolls its count back with the rest. */
export async function hit(db: Db | Tx, rule: RateLimitRule, subject: string): Promise<Hit> {
  const now = Date.now();
  const start = windowStart(rule, now);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: keyOf(rule, subject), windowStart: start })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  // Old windows are dead weight; sweep them now and then instead of running a job for it.
  // Never awaited and never fatal: it must not slow down or fail somebody's login.
  if (row!.count === 1 && Math.random() < 0.02) {
    void db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(now - RETENTION_MS)))
      .catch(() => undefined);
  }
  return { count: row!.count, windowStart: start };
}

/**
 * Gives back an event counted by `hit` that turned out not to be one (a successful login).
 * Never fatal: the login already succeeded, a counter that stays one too high only fails closed.
 */
export async function refund(db: Db, rule: RateLimitRule, subject: string, counted: Hit) {
  await db
    .update(rateLimits)
    .set({ count: sql`${rateLimits.count} - 1` })
    .where(
      and(
        eq(rateLimits.key, keyOf(rule, subject)),
        eq(rateLimits.windowStart, counted.windowStart),
        gt(rateLimits.count, 0),
      ),
    )
    .catch(() => undefined);
}

/*
 * Login lockout (ALMA-90). The per-e-mail failure counter alone is a fixed window: ten failures at
 * 14:59 and ten more at 15:00 would pass. So the failure that reaches the limit also LOCKS the
 * e-mail from that moment, for 15 minutes; a lock that follows within an hour of the previous one
 * ending lasts 30, then 60 (the cap). Only a password reset ends a lock early (`unlockLogin`).
 *
 * A lock is keyed by the e-mail as typed (lower-cased), exactly like the counter, so an unknown
 * e-mail locks the same way as a known one: the answer never tells them apart.
 *
 * A lock is a row of the same table, under its own scope: `window_start` holds the moment the lock
 * ENDS and `count` its level (1, 2, 3). The sweep above removes it two hours after it ended, which
 * is longer than the hour a level is remembered. No table of its own: this is the same kind of
 * short-lived, hashed, per-subject counter.
 */
export const LOGIN_LOCK = {
  scope: 'login-lock:email',
  /** Minutes per level; the last one repeats. */
  minutes: [15, 30, 60],
  /** A new lock escalates when the previous one ended less than this ago. */
  memoryMs: 60 * MINUTE,
} as const;

/**
 * The second step's lock (ALMA-91): the same escalation as the login's, keyed by the user, and
 * never ended by a password reset — only by its time running out.
 */
export const SECOND_FACTOR_LOCK = {
  scope: 'second-factor-lock:user',
  minutes: [15, 30, 60],
  memoryMs: 60 * MINUTE,
} as const;

type LockRule = typeof LOGIN_LOCK | typeof SECOND_FACTOR_LOCK;

const lockKey = (email: string) => keyOf(LOGIN_LOCK, email);

async function lockedUntil(db: Db | Tx, key: string): Promise<Date | null> {
  const [row] = await db
    .select({ until: sql<Date | null>`max(${rateLimits.windowStart})` })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), gt(rateLimits.windowStart, new Date())));
  return row?.until ? new Date(row.until) : null;
}

async function lock(db: Db | Tx, rule: LockRule, key: string): Promise<{ minutes: number }> {
  const now = Date.now();
  const [previous] = await db
    .select({ level: sql<number | null>`max(${rateLimits.count})` })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), gt(rateLimits.windowStart, new Date(now - rule.memoryMs))));
  const level = (previous?.level ?? 0) + 1;
  const minutes = rule.minutes[Math.min(level, rule.minutes.length) - 1]!;
  await db
    .insert(rateLimits)
    .values({ key, windowStart: new Date(now + minutes * MINUTE), count: level })
    .onConflictDoNothing();
  return { minutes };
}

/** When the lock on this e-mail ends, or `null` when it is not locked. */
export const loginLockedUntil = (db: Db | Tx, email: string) => lockedUntil(db, lockKey(email));

/** Locks the e-mail from now on; returns for how many minutes (the level's). */
export const lockLogin = (db: Db | Tx, email: string) => lock(db, LOGIN_LOCK, lockKey(email));

/** When the lock on her second step ends, or `null` (ALMA-91). */
export const secondFactorLockedUntil = (db: Db | Tx, userId: string) =>
  lockedUntil(db, keyOf(SECOND_FACTOR_LOCK, userId));

/** Locks her second step from now on; returns for how many minutes. */
export const lockSecondFactor = (db: Db | Tx, userId: string) =>
  lock(db, SECOND_FACTOR_LOCK, keyOf(SECOND_FACTOR_LOCK, userId));

/**
 * Takes a one-time value (a second-step challenge, ALMA-91): `true` for the first caller, `false`
 * for every later one. A row of this table under its own scope, like a lock; `until` is when the
 * value expires anyway, so the sweep removes the row two hours after that. `releaseOnce` gives it
 * back, for a call that took it and then failed for another reason (a mistyped code).
 */
export async function claimOnce(db: Db | Tx, scope: string, subject: string, until: Date) {
  const claimed = await db
    .insert(rateLimits)
    .values({ key: keyOf({ scope }, subject), windowStart: until })
    .onConflictDoNothing()
    .returning({ key: rateLimits.key });
  return claimed.length > 0;
}

export async function releaseOnce(db: Db | Tx, scope: string, subject: string, until: Date) {
  await db
    .delete(rateLimits)
    .where(and(eq(rateLimits.key, keyOf({ scope }, subject)), eq(rateLimits.windowStart, until)));
}

/**
 * A password reset proves the mailbox, so it ends the lock and forgets the failures counted for the
 * e-mail. Answers whether a lock was in force.
 */
export async function unlockLogin(db: Db | Tx, email: string): Promise<boolean> {
  const failures = keyOf(RATE_LIMITS.loginFailuresPerEmail, email);
  const removed = await db
    .delete(rateLimits)
    .where(inArray(rateLimits.key, [lockKey(email), failures]))
    .returning({ key: rateLimits.key, windowStart: rateLimits.windowStart });
  const key = lockKey(email);
  return removed.some((row) => row.key === key && row.windowStart.getTime() > Date.now());
}
