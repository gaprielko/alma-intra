import { randomUUID } from 'node:crypto';
import { WEB_IDLE_TIMEOUT_MS } from '@intra/shared/schemas';
import type { Role } from '@intra/shared/auth';
import argon2 from 'argon2';
import { and, desc, eq, gt, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Db, Tx } from '../db/db.module.js';
import { refreshTokens, users } from '../db/schema/index.js';
import { forgetTrustedDevices, type SecondStep, secondStepFor } from './second-factor.service.js';
import { hashRefreshToken, newRefreshToken, signAccessToken } from './tokens.js';

export interface IssuedTokens {
  userId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

// Verified when the e-mail is unknown, so response time does not reveal which e-mails exist.
const DUMMY_HASH = await argon2.hash('intra-dummy-password');

/** Only an active user holds a session: an invited one has not finished, a deactivated one is out. */
const isActive = and(eq(users.status, 'active'), isNull(users.deletedAt));

async function issue(
  db: Db | Tx,
  env: Env,
  userId: string,
  familyId: string,
  userAgent: string | null,
): Promise<IssuedTokens> {
  const refreshToken = newRefreshToken();
  // A refresh token lives as long as the idle timeout: a token nobody rotated for an hour is dead.
  // Each rotation starts the hour again, so a session in use never runs out.
  const refreshExpiresAt = new Date(Date.now() + WEB_IDLE_TIMEOUT_MS);
  await db.insert(refreshTokens).values({
    familyId,
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshExpiresAt,
    userAgent,
  });
  const accessToken = await accessTokenFor(env, userId, familyId);
  return { userId, accessToken, refreshToken, refreshExpiresAt };
}

const accessTokenFor = (env: Env, userId: string, familyId: string) =>
  signAccessToken({ userId, sessionId: familyId }, env.AUTH_ACCESS_SECRET, env.AUTH_ACCESS_TTL);

/**
 * A new session (not a rotation): a new token family. Starts only after the second step (or its
 * setup): the second factor is mandatory, so there is no other way in.
 */
export async function startSession(
  db: Db,
  env: Env,
  userId: string,
  userAgent: string | null,
): Promise<IssuedTokens | null> {
  const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isActive));
  if (!user) return null;
  const tokens = await issue(db, env, userId, randomUUID(), userAgent);
  // Never fatal: the token above is already live, and a login must not fail over a timestamp.
  await db
    .update(users)
    .set({ lastLoginAt: sql`now()`, firstLoginAt: sql`coalesce(${users.firstLoginAt}, now())` })
    .where(eq(users.id, userId))
    .catch(() => undefined);
  purgeRefreshTokensNowAndThen(db);
  return tokens;
}

const REFRESH_TOKEN_RETENTION_DAYS = 30;

/**
 * Tokens that were revoked (rotated, logged out) or expired more than 30 days ago are history
 * nobody reads. Presenting one of them afterwards is an unknown token: refused, but it no longer
 * ends its family.
 */
export async function purgeRefreshTokens(db: Db): Promise<void> {
  const cutoff = sql`now() - make_interval(days => ${REFRESH_TOKEN_RETENTION_DAYS})`;
  await db
    .delete(refreshTokens)
    .where(or(lt(refreshTokens.revokedAt, cutoff), lt(refreshTokens.expiresAt, cutoff)));
}

/** Now and then, never awaited, never fatal to somebody's login. */
function purgeRefreshTokensNowAndThen(db: Db) {
  if (Math.random() < 0.01) void purgeRefreshTokens(db).catch(() => undefined);
}

export type LoginResult =
  /** The password was right: the second step (or its setup) is owed. No session yet. */
  | { ok: true; secondStep: SecondStep; userId: string }
  /** `userId` is for the audit trail only (known e-mail, wrong password); never sent to the client. */
  | { ok: false; reason: 'invalid' | 'deactivated'; userId: string | null };

/**
 * `invalid` for an unknown e-mail, a wrong password or an invitation not accepted yet,
 * indistinguishable on purpose. `deactivated` is only revealed after the correct password.
 * `trustedDeviceToken` is the browser's „Zapamätať toto zariadenie“ cookie, when it sent one: a
 * trusted browser skips the code, never the password, and never the setup.
 */
export async function login(
  db: Db,
  input: { email: string; password: string; trustedDeviceToken?: string | undefined },
): Promise<LoginResult | { ok: true; trusted: true; userId: string }> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .where(and(eq(sql`lower(${users.email})`, input.email.toLowerCase()), isNull(users.deletedAt)));

  const passwordOk = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, input.password);
  if (!user || !passwordOk || user.status === 'invited') {
    return { ok: false, reason: 'invalid', userId: user?.id ?? null };
  }
  if (user.status === 'deactivated') return { ok: false, reason: 'deactivated', userId: user.id };

  const secondStep = await secondStepFor(db, user.id, input.trustedDeviceToken);
  if (secondStep) return { ok: true, secondStep, userId: user.id };
  return { ok: true, trusted: true, userId: user.id };
}

/**
 * How long after its rotation a refresh token is still answered instead of treated as stolen: two
 * tabs (or a retry) that were already in flight with the same token.
 */
export const REFRESH_GRACE_MS = 10_000;

/**
 * The answer to a refresh. `refreshToken: null` is the grace answer: a new access token for the
 * same session and nothing else; the successor of the presented token went to whoever rotated it.
 */
export type RefreshedTokens =
  IssuedTokens | { userId: string; accessToken: string; refreshToken: null };

/** A session (`sid` of the access token = refresh token family) lives while it has a usable token. */
export async function isSessionAlive(db: Db | Tx, familyId: string): Promise<boolean> {
  const [live] = await db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.familyId, familyId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return live !== undefined;
}

/**
 * The user behind a live session, with her role, while she is active; `null` otherwise. One
 * indexed lookup per HTTP request: logout, a reused token, a password change and a deactivation
 * take effect at once instead of within the 15 minutes of an access token.
 */
export async function sessionUser(
  db: Db | Tx,
  userId: string,
  familyId: string,
): Promise<{ role: Role } | null> {
  const [row] = await db
    .select({ role: users.role })
    .from(refreshTokens)
    .innerJoin(users, eq(users.id, refreshTokens.userId))
    .where(
      and(
        eq(refreshTokens.familyId, familyId),
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
        isActive,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Rotates a refresh token: the presented row is locked, revoked and replaced in ONE transaction, so
 * a session never exists without a usable token and parallel refreshes are serialized.
 *
 * Presenting a token that was already rotated means it leaked, so the whole family is revoked,
 * unless it was rotated less than `REFRESH_GRACE_MS` ago and the family is still alive: that is a
 * second tab racing the first. It gets an access token only.
 * Returns `null` whenever the caller has to log in again.
 */
export async function refresh(
  db: Db,
  env: Env,
  presented: string,
): Promise<RefreshedTokens | null> {
  const tokenHash = hashRefreshToken(presented);

  return db.transaction(async (tx) => {
    // Age and expiry are judged by the database clock, the one that stamped `rotated_at`.
    const [row] = await tx
      .select({
        id: refreshTokens.id,
        familyId: refreshTokens.familyId,
        userId: refreshTokens.userId,
        revokedAt: refreshTokens.revokedAt,
        userAgent: refreshTokens.userAgent,
        expired: sql<boolean>`${refreshTokens.expiresAt} <= clock_timestamp()`,
        rotatedJustNow: sql<boolean>`coalesce(${refreshTokens.rotatedAt} > clock_timestamp() - make_interval(secs => ${REFRESH_GRACE_MS / 1000}), false)`,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for('update');
    if (!row) return null;

    const endSession = async () => {
      await revokeWhere(tx, eq(refreshTokens.familyId, row.familyId));
      return null;
    };
    const mayHoldSession = async () => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, row.userId), isActive));
      return user !== undefined;
    };

    if (row.revokedAt) {
      const racing = row.rotatedJustNow && (await isSessionAlive(tx, row.familyId));
      if (racing && (await mayHoldSession())) {
        return {
          userId: row.userId,
          accessToken: await accessTokenFor(env, row.userId, row.familyId),
          refreshToken: null,
        };
      }
      return endSession();
    }
    if (row.expired || !(await mayHoldSession())) return endSession();

    await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`clock_timestamp()`, rotatedAt: sql`clock_timestamp()` })
      .where(eq(refreshTokens.id, row.id));
    return issue(tx, env, row.userId, row.familyId, row.userAgent);
  });
}

/*
 * Revoking against a rotation in flight. `refresh()` holds the lock of the token it was presented
 * with while it inserts the successor. An UPDATE that merely waited for that lock would still work
 * from a snapshot taken before the successor existed, and miss it. So `logout` and the revocations
 * below first take the row locks (waiting for any rotation to commit) and revoke in a SECOND
 * statement, whose snapshot sees the successor.
 */

/** Revokes the family of the presented refresh token; returns its user, `null` for an unknown token. */
export async function logout(db: Db, presented: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ familyId: refreshTokens.familyId, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(presented)))
      .for('update');
    if (!row) return null;
    await revokeWhere(tx, eq(refreshTokens.familyId, row.familyId));
    return row.userId;
  });
}

/**
 * Every session of the user ends at once. `clock_timestamp()`, not `now()`: a second-step challenge
 * issued in the same transaction must be older than it.
 */
async function markSessionsRevoked(tx: Tx, userId: string) {
  await tx
    .update(users)
    .set({ sessionsRevokedAt: sql`clock_timestamp()` })
    .where(eq(users.id, userId));
}

/**
 * For a deactivation, a new password, a reset of the second factor. Every browser trusted at the
 * second step is forgotten with the sessions.
 */
export async function revokeUserSessions(db: Db | Tx, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .orderBy(refreshTokens.id)
      .for('update');
    await revokeWhere(tx, eq(refreshTokens.userId, userId));
    await markSessionsRevoked(tx, userId);
    await forgetTrustedDevices(tx, userId);
  });
}

/**
 * „Odhlásiť ostatné“ and a password change: every session of the user but the one making the
 * change. With `forgetDevices` (a new password, a new phone) every trusted browser too.
 */
export async function revokeOtherSessions(
  db: Db | Tx,
  userId: string,
  keepFamilyId: string,
  options: { forgetDevices: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const others = and(eq(refreshTokens.userId, userId), ne(refreshTokens.familyId, keepFamilyId));
    await tx
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(others, isNull(refreshTokens.revokedAt)))
      .orderBy(refreshTokens.id)
      .for('update');
    await revokeWhere(tx, others!);
    await markSessionsRevoked(tx, userId);
    if (options.forgetDevices) await forgetTrustedDevices(tx, userId);
  });
}

/** „Odhlásiť“ next to one of her own sessions. Answers whether a live session ended. */
export async function revokeSessionFamily(
  db: Db | Tx,
  userId: string,
  familyId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const family = and(eq(refreshTokens.userId, userId), eq(refreshTokens.familyId, familyId));
    await tx
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(family, isNull(refreshTokens.revokedAt)))
      .orderBy(refreshTokens.id)
      .for('update');
    const ended = await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(family, isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return ended.length > 0;
  });
}

/**
 * Her live sessions for „Aktívne prihlásenia“: when each started (the first token of its family),
 * when it was last active (the live token's issue) and its browser. Newest activity first.
 */
export async function listSessions(db: Db | Tx, userId: string) {
  return db
    .select({
      sessionId: refreshTokens.familyId,
      userAgent: refreshTokens.userAgent,
      lastActiveAt: refreshTokens.createdAt,
      startedAt: sql<Date>`(select min(r.created_at) from refresh_tokens r where r.family_id = ${refreshTokens.familyId})`.mapWith(refreshTokens.createdAt),
    })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(refreshTokens.createdAt));
}

async function revokeWhere(db: Db | Tx, condition: SQL, at: Date | SQL = new Date()) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: at })
    .where(and(condition, isNull(refreshTokens.revokedAt)));
}

/** The signed-in user, for the web's session store. */
export async function me(db: Db, userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      phone: users.phone,
      position: users.position,
      emailSignature: users.emailSignature,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.id, userId), isActive));
  return user ?? null;
}
