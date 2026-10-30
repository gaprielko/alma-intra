import argon2 from 'argon2';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { UpdateProfileInput } from '@intra/shared/schemas';
import type { Db, Tx } from '../db/db.module.js';
import { authTokens, users } from '../db/schema/index.js';
import type { BreachCheck } from '../security/breached-password.js';
import { revokeOtherSessions, revokeUserSessions } from './auth.service.js';
import { hashRefreshToken as hashToken, newRefreshToken as newToken } from './tokens.js';

/**
 * A new password known from a breach is refused. Asked only once everything cheaper has passed (a
 * live link, the length rule, the current password), so a junk request never makes the server
 * call Have I Been Pwned. `null`: the check is switched off.
 */
const isBreached = async (check: BreachCheck | null, password: string) =>
  check !== null && (await check(password));

/** An invitation link lives 72 hours; a reset link an hour. Both are one-time. */
export const INVITATION_TTL_MS = 72 * 3_600_000;
export const PASSWORD_RESET_TTL_MS = 60 * 60_000;

type NewToken = { type: 'invitation' | 'password_reset'; userId: string; ttlMs: number };

/**
 * Inserts a one-time token and returns the raw value for the e-mail link; only its hash is stored.
 * Earlier tokens stay valid, see `supersedeAuthTokens`.
 */
export async function issueAuthToken(
  db: Db | Tx,
  input: NewToken,
): Promise<{ id: string; token: string }> {
  const token = newToken();
  const [row] = await db
    .insert(authTokens)
    .values({
      type: input.type,
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + input.ttlMs),
    })
    .returning({ id: authTokens.id });
  return { id: row!.id, token };
}

/** Every other unused token of the same type for the user stops working: only the latest link is valid. */
export async function supersedeAuthTokens(
  db: Db | Tx,
  keep: { id: string; userId: string; type: NewToken['type'] },
): Promise<void> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, keep.userId),
        eq(authTokens.type, keep.type),
        ne(authTokens.id, keep.id),
        isNull(authTokens.usedAt),
      ),
    );
}

export const supersedeKey = (id: string, input: NewToken) => ({
  id,
  userId: input.userId,
  type: input.type,
});

/**
 * Every unused link of one type stops working: a withdrawn invitation must not come back to life
 * when the person is invited again later.
 */
export async function revokeAuthTokens(
  db: Db | Tx,
  userId: string,
  type: NewToken['type'],
): Promise<void> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(authTokens.userId, userId), eq(authTokens.type, type), isNull(authTokens.usedAt)),
    );
}

/** A token whose e-mail never left: removed, so that a retry does not pile up live links. */
export async function discardAuthToken(db: Db | Tx, id: string): Promise<void> {
  await db.delete(authTokens).where(and(eq(authTokens.id, id), isNull(authTokens.usedAt)));
}

async function lockUsableToken(tx: Tx, type: NewToken['type'], presented: string) {
  const [row] = await tx
    .select()
    .from(authTokens)
    .where(eq(authTokens.tokenHash, hashToken(presented)))
    .for('update');
  return !row || row.type !== type || row.usedAt || row.expiresAt <= new Date() ? null : row;
}

export type ResetPasswordResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'invalid_token' | 'breached_password' };

/**
 * Consumes a password reset token and sets the password in one transaction, then ends every
 * existing session of the user. `invalid_token` when the token is unknown, used, expired or of
 * another type, or the user is not active; `breached_password` leaves the token usable for another
 * try. The e-mail is for ending a login lock.
 */
export async function resetPassword(
  db: Db,
  presented: string,
  password: string,
  breachCheck: BreachCheck | null,
): Promise<ResetPasswordResult> {
  const invalid = { ok: false, reason: 'invalid_token' } as const;
  // Hashing is expensive on purpose; do it only for a token that exists, so junk tokens are cheap
  // to refuse. The authoritative check is the locked read below.
  const [known] = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashToken(presented)), isNull(authTokens.usedAt)));
  if (!known) return invalid;
  if (await isBreached(breachCheck, password)) return { ok: false, reason: 'breached_password' };
  const passwordHash = await argon2.hash(password);

  const user = await db.transaction(async (tx) => {
    const row = await lockUsableToken(tx, 'password_reset', presented);
    if (!row) return null;
    const [updated] = await tx
      .update(users)
      .set({ passwordHash, updatedAt: sql`now()` })
      .where(and(eq(users.id, row.userId), eq(users.status, 'active'), isNull(users.deletedAt)))
      .returning({ id: users.id, email: users.email });
    if (!updated) return null;
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    return updated;
  });
  if (!user) return invalid;

  await revokeUserSessions(db, user.id);
  return { ok: true, userId: user.id, email: user.email };
}

export type AcceptInvitationResult =
  { ok: true; userId: string } | { ok: false; reason: 'invalid_token' | 'breached_password' };

/**
 * Sets the invited person's first password and makes her active. The second factor follows at
 * once (the router answers a setup challenge): there is no session before it. The token row and
 * the user row are locked, so a withdrawal cannot slip in between the check and the write.
 */
export async function acceptInvitation(
  db: Db,
  presented: string,
  password: string,
  breachCheck: BreachCheck | null,
): Promise<AcceptInvitationResult> {
  const invalid = { ok: false, reason: 'invalid_token' } as const;
  if (!(await findUsableInvitation(db, presented))) return invalid;
  if (await isBreached(breachCheck, password)) return { ok: false, reason: 'breached_password' };
  const passwordHash = await argon2.hash(password);

  const userId = await db.transaction(async (tx) => {
    const row = await lockUsableToken(tx, 'invitation', presented);
    if (!row) return null;
    const [activated] = await tx
      .update(users)
      .set({ passwordHash, status: 'active', activatedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(users.id, row.userId), eq(users.status, 'invited'), isNull(users.deletedAt)))
      .returning({ id: users.id });
    if (!activated) return null;
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    return activated.id;
  });
  return userId ? { ok: true, userId } : invalid;
}

/**
 * Returns the user who can log in with this e-mail, otherwise `null`. The caller must answer the
 * client identically in both cases. The token is created when the e-mail is sent.
 */
export async function requestPasswordReset(
  db: Db,
  email: string,
): Promise<{ userId: string } | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(sql`lower(${users.email})`, email.toLowerCase()),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
        isNotNull(users.passwordHash),
      ),
    );
  return user ? { userId: user.id } : null;
}

/**
 * The invitation behind a link, only if it could be accepted right now: an unused, unexpired
 * invitation token of a user who is still `invited`. `null` for anything else, without saying
 * which check failed.
 */
export async function findUsableInvitation(db: Db, presented: string) {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      type: authTokens.type,
      usedAt: authTokens.usedAt,
      expiresAt: authTokens.expiresAt,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(eq(authTokens.tokenHash, hashToken(presented)));
  if (
    !row ||
    row.type !== 'invitation' ||
    row.usedAt ||
    row.expiresAt <= new Date() ||
    row.status !== 'invited' ||
    row.deletedAt
  ) {
    return null;
  }
  return { userId: row.userId, email: row.email, expiresAt: row.expiresAt };
}

/**
 * One's own details and signature. Answers which fields changed, for the audit event: names,
 * never values.
 */
export async function setImportAddresses(db: Db | Tx, userId: string, addresses: string[]) {
  await db
    .update(users)
    .set({ importAddresses: [...new Set(addresses)] })
    .where(eq(users.id, userId));
}

export async function updateProfile(
  db: Db | Tx,
  userId: string,
  input: UpdateProfileInput,
): Promise<('name' | 'titleBefore' | 'titleAfter' | 'phone' | 'position' | 'emailSignature')[]> {
  const [current] = await db
    .select({
      name: users.name,
      titleBefore: users.titleBefore,
      titleAfter: users.titleAfter,
      phone: users.phone,
      position: users.position,
      emailSignature: users.emailSignature,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (!current) return [];
  // Not sent: left as it is. Sent empty: cleared.
  const next = {
    name: input.name,
    titleBefore: input.titleBefore === undefined ? current.titleBefore : input.titleBefore || null,
    titleAfter: input.titleAfter === undefined ? current.titleAfter : input.titleAfter || null,
    phone: input.phone === undefined ? current.phone : input.phone || null,
    position: input.position === undefined ? current.position : input.position || null,
    emailSignature:
      input.emailSignature === undefined
        ? current.emailSignature
        : input.emailSignature.trim() || null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (key) => next[key] !== current[key],
  );
  if (changed.length > 0) {
    await db
      .update(users)
      .set({ ...next, updatedAt: sql`now()` })
      .where(eq(users.id, userId));
  }
  return changed;
}

/**
 * The password change of „Môj účet“: the current password is checked, the new one stored; the
 * session making the change stays and every other session of the user ends. `wrong_password` when
 * the current one does not match, `breached_password` when the new one is known from a breach.
 */
export async function changePassword(
  db: Db,
  userId: string,
  sessionFamilyId: string,
  currentPassword: string,
  newPassword: string,
  breachCheck: BreachCheck | null,
): Promise<{ ok: true } | { ok: false; reason: 'wrong_password' | 'breached_password' }> {
  if (!(await isCurrentPassword(db, userId, currentPassword))) {
    return { ok: false, reason: 'wrong_password' };
  }
  if (await isBreached(breachCheck, newPassword)) return { ok: false, reason: 'breached_password' };
  const passwordHash = await argon2.hash(newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: sql`now()` })
      .where(eq(users.id, userId));
    await revokeOtherSessions(tx, userId, sessionFamilyId, { forgetDevices: true });
    // A reset link sent before the change must not set another password afterwards.
    await revokeAuthTokens(tx, userId, 'password_reset');
  });
  return { ok: true };
}

/** Whether `password` is the user's current one. The caller counts the attempt. */
export async function isCurrentPassword(db: Db | Tx, userId: string, password: string) {
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  return Boolean(user?.passwordHash) && (await argon2.verify(user!.passwordHash!, password));
}
