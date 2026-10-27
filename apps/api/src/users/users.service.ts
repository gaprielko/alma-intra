import type { InviteUserInput, UpdateUserInput, UserStatus } from '@intra/shared/schemas';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { revokeAuthTokens } from '../auth/account.service.js';
import { revokeUserSessions } from '../auth/auth.service.js';
import { removeSecondFactor } from '../auth/second-factor.service.js';
import type { Db, Tx } from '../db/db.module.js';
import { userSecondFactors, users } from '../db/schema/index.js';
import { dropQueuedInvitation, enqueueMail, invitationDelivery } from '../mail/mail-outbox.js';

/** A refusal the web words for itself (`sk.users.errors`). */
export class UserError extends Error {
  constructor(readonly code: 'EMAIL_TAKEN' | 'LAST_ACTIVE_USER' | 'NOT_INVITED' | 'NOT_FOUND') {
    super(code);
  }
}

const alive = isNull(users.deletedAt);

/**
 * Settings › Používatelia: everybody, the newest invitation's delivery for an invited one, whether
 * the second factor is set up. Names first, case and accents as a person reads them.
 */
export async function listUsers(db: Db | Tx, filter: { status?: UserStatus | undefined }) {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      position: users.position,
      status: users.status,
      invitedAt: users.invitedAt,
      lastLoginAt: users.lastLoginAt,
      secondFactor: sql<boolean>`${userSecondFactors.confirmedAt} is not null`,
      invitationDelivery,
    })
    .from(users)
    .leftJoin(userSecondFactors, eq(userSecondFactors.userId, users.id))
    .where(alive)
    .orderBy(sql`${users.name} collate "sk-x-icu"`, asc(users.id));
  const counts = { all: rows.length, invited: 0, active: 0, deactivated: 0 };
  for (const row of rows) counts[row.status] += 1;
  return {
    items: filter.status ? rows.filter((row) => row.status === filter.status) : rows,
    counts,
  };
}

/**
 * A new user, `invited`, and her invitation queued in the same transaction. An e-mail that
 * already has an account (in any state) is refused by name: the web says so under the field.
 */
export async function inviteUser(db: Db | Tx, invitedBy: string, input: InviteUserInput) {
  return db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email.toLowerCase()));
    if (taken) throw new UserError('EMAIL_TAKEN');
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        phone: input.phone || null,
        position: input.position || null,
        status: 'invited',
        invitedByUserId: invitedBy,
      })
      .returning({ id: users.id });
    await enqueueMail(tx, { kind: 'invitation', userId: user!.id });
    return { id: user!.id };
  });
}

/** A colleague's details. Her e-mail is her login and stays. */
export async function updateUser(db: Db | Tx, input: UpdateUserInput) {
  const updated = await db
    .update(users)
    .set({
      name: input.name,
      ...(input.phone === undefined ? {} : { phone: input.phone || null }),
      ...(input.position === undefined ? {} : { position: input.position || null }),
      updatedAt: sql`now()`,
    })
    .where(and(eq(users.id, input.userId), alive))
    .returning({ id: users.id });
  if (updated.length === 0) throw new UserError('NOT_FOUND');
}

async function statusOf(tx: Tx, userId: string) {
  const [user] = await tx
    .select({ status: users.status, activatedAt: users.activatedAt })
    .from(users)
    .where(and(eq(users.id, userId), alive))
    .for('update');
  if (!user) throw new UserError('NOT_FOUND');
  return user;
}

/**
 * Takes the access away: her sessions end at once, her links stop working. An invitation that was
 * never accepted is withdrawn the same way, and its queued mail is dropped. The last active user
 * stays: somebody must be able to let the others back in.
 */
export async function deactivateUser(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const user = await statusOf(tx, userId);
    if (user.status === 'deactivated') return { from: user.status };
    if (user.status === 'active') {
      // Serialised on the active rows, so two colleagues deactivating each other at once cannot
      // leave nobody.
      const others = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.status, 'active'), ne(users.id, userId), alive))
        .for('update');
      if (others.length === 0) throw new UserError('LAST_ACTIVE_USER');
    }
    await tx
      .update(users)
      .set({ status: 'deactivated', deactivatedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, userId));
    await revokeAuthTokens(tx, userId, 'invitation');
    await revokeAuthTokens(tx, userId, 'password_reset');
    await dropQueuedInvitation(tx, userId);
    await revokeUserSessions(tx, userId);
    return { from: user.status };
  });
}

/**
 * Gives the access back. Somebody who had accepted her invitation is `active` again and signs in
 * as before; somebody who never set a password is `invited` again with a new link.
 */
export async function reactivateUser(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const user = await statusOf(tx, userId);
    if (user.status !== 'deactivated') return { to: user.status, invitationSent: false };
    const to = user.activatedAt ? 'active' : 'invited';
    await tx
      .update(users)
      .set({
        status: to,
        deactivatedAt: null,
        ...(to === 'invited' ? { invitedAt: sql`now()` } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId));
    const invitationSent =
      to === 'invited' && (await enqueueMail(tx, { kind: 'invitation', userId }));
    return { to, invitationSent };
  });
}

/**
 * „Poslať znova“: a new invitation mail with a new link, which supersedes the old one when it goes
 * out. `false` while the previous mail is still on its way: that one will arrive.
 */
export async function resendInvitation(db: Db | Tx, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const user = await statusOf(tx, userId);
    if (user.status !== 'invited') throw new UserError('NOT_INVITED');
    return enqueueMail(tx, { kind: 'invitation', userId });
  });
}

/**
 * For somebody who lost her phone: the factor, the recovery codes and the trusted browsers go,
 * her sessions end, and she sets up a new factor at the next login. She is told by e-mail.
 */
export async function resetUserSecondFactor(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const user = await statusOf(tx, userId);
    if (user.status === 'invited') throw new UserError('NOT_FOUND');
    const removed = await removeSecondFactor(tx, userId);
    await revokeUserSessions(tx, userId);
    if (removed) await enqueueMail(tx, { kind: 'second_factor_changed', userId, change: 'reset' });
    return { removed };
  });
}
