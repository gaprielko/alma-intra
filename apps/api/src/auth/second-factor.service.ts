import { hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../config/env.js';
import { decryptField, encryptField } from '../crypto/field-encryption.js';
import type { Db, Tx } from '../db/db.module.js';
import {
  secondFactorRecoveryCodes,
  secondFactorTrustedDevices,
  userSecondFactors,
  users,
} from '../db/schema/index.js';
import { hashRefreshToken, newRefreshToken } from './tokens.js';
import { base32Decode, matchTotp, newTotpSecret, otpauthUri } from './totp.js';

/*
 * The second factor: TOTP in an authenticator app, mandatory for everybody, recovery codes for a
 * lost phone, and „Zapamätať toto zariadenie“ for 30 days.
 *
 * Between the password and the code there is no session: the login answers a short-lived signed
 * challenge that only the second step accepts, and the tokens are issued once the code is right.
 */

/** The step still owed after a right password: a code, or (no factor yet) a setup. */
export type SecondStep = 'verify' | 'enrol';

/** How long the second step may take after the password; one QR scan and a code, with a margin. */
export const CHALLENGE_TTL = '5m';
/** „Zapamätať toto zariadenie“: the checkbox's promise. */
export const TRUSTED_DEVICE_TTL_MS = 30 * 86_400_000;
export const RECOVERY_CODE_COUNT = 10;
/** What an authenticator app lists the entry under. */
export const TOTP_ISSUER = 'Alma Intra';

/*
 * Its own issuer: an access token (`intra-api`) is never taken for a challenge, nor the other way
 * round: `verifyAccessToken` insists on its issuer and on a session id this token does not carry.
 */
const CHALLENGE_ISSUER = 'intra-api/second-factor';

/**
 * The challenge's own key, derived from `AUTH_ACCESS_SECRET` with HKDF: a key used for nothing
 * else, so an access token and a challenge can never be taken for each other even if an issuer
 * check were lost.
 */
const challengeKey = (env: Env) =>
  new Uint8Array(
    hkdfSync('sha256', env.AUTH_ACCESS_SECRET, '', 'intra:second-factor-challenge', 32),
  );

const secretLocation = (userId: string) => ({
  table: 'user_second_factors',
  column: 'secret_encrypted',
  rowId: userId,
});

/**
 * The challenge a right password (or a freshly set first password) earns. `jti` makes it
 * single-use (`claimChallenge`), and `issuedAtMs` lets a later end of all her sessions (a password
 * reset, a deactivation, a reset of the factor) kill it too (`challengeHolder`). Millisecond
 * precision: `iat` is whole seconds, and a challenge issued in the same second as a revocation
 * must not look older than it. Taken from the database clock, the one that stamps
 * `sessions_revoked_at`: an API instance whose clock runs ahead must not issue a challenge that
 * outlives a revocation.
 */
export async function signChallenge(db: Db | Tx, env: Env, userId: string, step: SecondStep) {
  const { rows } = await db.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  const issuedAtMs = new Date(rows[0]!.now).getTime();
  return new SignJWT({ step, issuedAtMs })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(CHALLENGE_ISSUER)
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(CHALLENGE_TTL)
    .sign(challengeKey(env));
}

export interface Challenge {
  userId: string;
  jti: string;
  issuedAtMs: number;
  expiresAt: Date;
}

/** A live challenge for `step`; `null` for anything else. */
export async function verifyChallenge(
  env: Env,
  token: string,
  step: SecondStep,
): Promise<Challenge | null> {
  try {
    const { payload } = await jwtVerify(token, challengeKey(env), {
      issuer: CHALLENGE_ISSUER,
      algorithms: ['HS256'],
    });
    if (
      typeof payload.sub !== 'string' ||
      payload.step !== step ||
      typeof payload.jti !== 'string' ||
      typeof payload.issuedAtMs !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      jti: payload.jti,
      issuedAtMs: payload.issuedAtMs,
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch {
    return null;
  }
}

/**
 * The e-mail of the challenge's user while the challenge still stands: she is active, and none of
 * her sessions was ended wholesale after it was issued (`users.sessions_revoked_at`, stamped by
 * `revokeUserSessions` / `revokeOtherSessions`). `null` otherwise.
 */
export async function challengeHolder(db: Db | Tx, challenge: Challenge) {
  const [user] = await db
    .select({ email: users.email, sessionsRevokedAt: users.sessionsRevokedAt })
    .from(users)
    .where(
      and(eq(users.id, challenge.userId), eq(users.status, 'active'), isNull(users.deletedAt)),
    );
  if (!user) return null;
  const revoked =
    user.sessionsRevokedAt && user.sessionsRevokedAt.getTime() >= challenge.issuedAtMs;
  return revoked ? null : { email: user.email };
}

/** The scope under which a used challenge is remembered until it expires (`claimOnce`). */
export const CHALLENGE_CLAIM_SCOPE = 'second-factor-challenge';

async function factorOf(db: Db | Tx, userId: string) {
  const [row] = await db
    .select()
    .from(userSecondFactors)
    .where(eq(userSecondFactors.userId, userId));
  return row ?? null;
}

const isConfirmed = (row: { confirmedAt: Date | null; secretEncrypted: string | null } | null) =>
  row?.confirmedAt != null && row.secretEncrypted !== null;

/**
 * What a right password still owes. A confirmed factor asks for its code, unless this browser was
 * trusted by her within 30 days (`null`: no step owed). Without one she must set it up first, and
 * no trusted browser skips that.
 */
export async function secondStepFor(
  db: Db | Tx,
  userId: string,
  trustedDeviceToken: string | undefined,
): Promise<SecondStep | null> {
  if (!isConfirmed(await factorOf(db, userId))) return 'enrol';
  return trustedDeviceToken && (await isTrustedDevice(db, userId, trustedDeviceToken))
    ? null
    : 'verify';
}

export async function secondFactorStatus(db: Db | Tx, userId: string) {
  const row = await factorOf(db, userId);
  const [left] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(secondFactorRecoveryCodes)
    .where(
      and(eq(secondFactorRecoveryCodes.userId, userId), isNull(secondFactorRecoveryCodes.usedAt)),
    );
  return {
    enabled: isConfirmed(row),
    confirmedAt: isConfirmed(row) ? row!.confirmedAt : null,
    recoveryCodesLeft: isConfirmed(row) ? (left?.count ?? 0) : 0,
  };
}

/**
 * A new secret, shown once as a QR code and as text. It waits beside the one in force (a new phone
 * must not end the old factor before the new one works) until a code of it is typed; a second
 * setup replaces a first that was never confirmed.
 */
export async function beginSetup(db: Db | Tx, env: Env, userId: string) {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (!user) throw new Error('beginSetup: no such user');
  const secret = newTotpSecret();
  const pending = encryptField(secret, env.DATA_ENCRYPTION_KEY, secretLocation(userId));
  await db
    .insert(userSecondFactors)
    .values({ userId, pendingSecretEncrypted: pending, pendingSince: sql`now()` })
    .onConflictDoUpdate({
      target: userSecondFactors.userId,
      set: { pendingSecretEncrypted: pending, pendingSince: sql`now()`, updatedAt: sql`now()` },
    });
  return { secret, otpauthUri: otpauthUri(secret, user.email, TOTP_ISSUER) };
}

const RECOVERY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** `k7m2p-x9q4d`: 50 random bits, grouped for reading aloud over the phone. */
function newRecoveryCode(): string {
  const chars = [...randomBytes(10)].map((byte) => RECOVERY_ALPHABET[byte & 31]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** As typed: case, spaces and the dash do not matter. */
const normaliseRecoveryCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, '');

/** A fresh set of recovery codes, shown once; only their hashes are kept and the old set goes. */
export async function newRecoveryCodes(db: Db | Tx, userId: string): Promise<string[]> {
  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const hashes = await Promise.all(recoveryCodes.map((c) => argon2.hash(normaliseRecoveryCode(c))));
  await db.transaction(async (tx) => {
    await tx.delete(secondFactorRecoveryCodes).where(eq(secondFactorRecoveryCodes.userId, userId));
    await tx
      .insert(secondFactorRecoveryCodes)
      .values(hashes.map((codeHash) => ({ userId, codeHash })));
  });
  return recoveryCodes;
}

export type ConfirmResult =
  | {
      ok: true;
      recoveryCodes: string[];
      /** A factor was in force before: this was a new phone, not a first setup. */
      replaced: boolean;
    }
  | { ok: false };

/**
 * The first code of the waiting secret makes it the one in force: its step is remembered as used,
 * a fresh set of recovery codes is made (shown once, only hashes kept) and every browser trusted
 * under the old factor has to pass the new one.
 */
export async function confirmSetup(
  db: Db,
  env: Env,
  userId: string,
  code: string,
): Promise<ConfirmResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(userSecondFactors)
      .where(eq(userSecondFactors.userId, userId))
      .for('update');
    if (!row?.pendingSecretEncrypted) return { ok: false };
    const secret = decryptField(
      row.pendingSecretEncrypted,
      env.DATA_ENCRYPTION_KEY,
      secretLocation(userId),
    );
    const step = matchTotp(base32Decode(secret), code, Date.now(), null);
    if (step === null) return { ok: false };

    await tx
      .update(userSecondFactors)
      .set({
        secretEncrypted: row.pendingSecretEncrypted,
        confirmedAt: sql`now()`,
        lastUsedStep: step,
        pendingSecretEncrypted: null,
        pendingSince: null,
        updatedAt: sql`now()`,
      })
      .where(eq(userSecondFactors.userId, userId));
    const recoveryCodes = await newRecoveryCodes(tx, userId);
    await forgetTrustedDevices(tx, userId);
    return { ok: true, recoveryCodes, replaced: row.confirmedAt !== null };
  });
}

export type VerifyMethod = 'totp' | 'recovery_code';

/**
 * The second step: a code of the confirmed secret, or one of her recovery codes. A TOTP code counts
 * once (its step is stored with a compare-and-set, so two requests racing with the same code get
 * one success between them), and a recovery code is stamped used in the same way.
 */
export async function verifySecondFactor(
  db: Db,
  env: Env,
  userId: string,
  code: string,
): Promise<{ ok: true; method: VerifyMethod; recoveryCodesLeft: number } | { ok: false }> {
  const row = await factorOf(db, userId);
  if (!isConfirmed(row)) return { ok: false };

  if (/^\d{6}$/.test(code)) {
    const secret = decryptField(
      row!.secretEncrypted!,
      env.DATA_ENCRYPTION_KEY,
      secretLocation(userId),
    );
    const step = matchTotp(base32Decode(secret), code, Date.now(), row!.lastUsedStep);
    if (step === null) return { ok: false };
    const claimed = await db
      .update(userSecondFactors)
      .set({ lastUsedStep: step, updatedAt: sql`now()` })
      .where(
        and(
          eq(userSecondFactors.userId, userId),
          or(isNull(userSecondFactors.lastUsedStep), lt(userSecondFactors.lastUsedStep, step)),
        ),
      )
      .returning({ userId: userSecondFactors.userId });
    if (claimed.length === 0) return { ok: false };
    return { ok: true, method: 'totp', recoveryCodesLeft: await recoveryCodesLeft(db, userId) };
  }

  const typed = normaliseRecoveryCode(code);
  if (!/^[a-z2-7]{10}$/.test(typed)) return { ok: false };
  const unused = await db
    .select({ id: secondFactorRecoveryCodes.id, codeHash: secondFactorRecoveryCodes.codeHash })
    .from(secondFactorRecoveryCodes)
    .where(
      and(eq(secondFactorRecoveryCodes.userId, userId), isNull(secondFactorRecoveryCodes.usedAt)),
    );
  for (const candidate of unused) {
    if (!(await argon2.verify(candidate.codeHash, typed))) continue;
    const used = await db
      .update(secondFactorRecoveryCodes)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(secondFactorRecoveryCodes.id, candidate.id),
          isNull(secondFactorRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: secondFactorRecoveryCodes.id });
    if (used.length === 0) return { ok: false };
    return {
      ok: true,
      method: 'recovery_code',
      recoveryCodesLeft: await recoveryCodesLeft(db, userId),
    };
  }
  return { ok: false };
}

async function recoveryCodesLeft(db: Db | Tx, userId: string) {
  return (await secondFactorStatus(db, userId)).recoveryCodesLeft;
}

/**
 * The factor is gone: the secret (confirmed and waiting), the recovery codes and every trusted
 * browser. Used when a colleague resets it for somebody who lost her phone; she sets up a new one
 * at her next login. Answers whether there was a confirmed factor to remove.
 */
export async function removeSecondFactor(db: Db | Tx, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(userSecondFactors)
      .where(eq(userSecondFactors.userId, userId))
      .returning({ confirmedAt: userSecondFactors.confirmedAt });
    await tx.delete(secondFactorRecoveryCodes).where(eq(secondFactorRecoveryCodes.userId, userId));
    await forgetTrustedDevices(tx, userId);
    return removed.some((row) => row.confirmedAt !== null);
  });
}

/** Whether she has a confirmed factor. */
export async function hasSecondFactor(db: Db | Tx, userId: string): Promise<boolean> {
  return isConfirmed(await factorOf(db, userId));
}

/** A browser she trusted at the second step: a random token for its cookie, its hash kept here. */
export async function trustDevice(db: Db | Tx, userId: string) {
  const token = newRefreshToken();
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_MS);
  await db
    .insert(secondFactorTrustedDevices)
    .values({ userId, tokenHash: hashRefreshToken(token), expiresAt });
  // Expired rows are dead weight; they go with the next trust she gives.
  await db
    .delete(secondFactorTrustedDevices)
    .where(
      and(
        eq(secondFactorTrustedDevices.userId, userId),
        lt(secondFactorTrustedDevices.expiresAt, sql`now()`),
      ),
    );
  return { token, expiresAt };
}

/** Only her own token counts: a cookie left by somebody else on a shared computer is nothing. */
async function isTrustedDevice(db: Db | Tx, userId: string, token: string) {
  const [row] = await db
    .select({ id: secondFactorTrustedDevices.id })
    .from(secondFactorTrustedDevices)
    .where(
      and(
        eq(secondFactorTrustedDevices.tokenHash, hashRefreshToken(token)),
        eq(secondFactorTrustedDevices.userId, userId),
        gt(secondFactorTrustedDevices.expiresAt, sql`now()`),
      ),
    );
  return row !== undefined;
}

/** Every browser she trusted must pass the second step again. */
export async function forgetTrustedDevices(db: Db | Tx, userId: string) {
  await db.delete(secondFactorTrustedDevices).where(eq(secondFactorTrustedDevices.userId, userId));
}
