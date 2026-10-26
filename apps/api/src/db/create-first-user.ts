import { and, eq, ne, sql } from 'drizzle-orm';
import { enqueueMail } from '../mail/mail-outbox.js';
import type { Db } from './db.module.js';
import { users } from './schema/index.js';

export type CreateFirstUserResult =
  | { outcome: 'invited'; userId: string }
  /** Invited before and not accepted yet: the invitation is queued again. */
  | { outcome: 'invited_again'; userId: string }
  | { outcome: 'already_active'; userId: string }
  /** Somebody else already works in the app: they invite people, not this command. */
  | { outcome: 'others_exist' }
  /** The e-mail belongs to a deactivated user; the command does not undo that. */
  | { outcome: 'deactivated'; userId: string };

/**
 * Bootstrap of the first user: the only way into an empty Alma Intra. The user gets NO password
 * here: an `invited` account and an invitation through the mail outbox, and she sets her own
 * password and second factor on `/activate`. From then on people are invited in the app.
 * Idempotent: running it again for the same e-mail creates nothing twice and at most queues the
 * mail again. Refused once anybody else has an account.
 */
export async function createFirstUser(
  db: Db,
  input: { email: string; name: string },
): Promise<CreateFirstUserResult> {
  return db.transaction(async (tx) => {
    // Two runs at once wait for each other here instead of creating two first users.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('create-first-user'))`);
    const email = eq(sql`lower(${users.email})`, input.email.toLowerCase());

    const [existing] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(email);
    const [other] = await tx
      .select({ id: users.id })
      .from(users)
      .where(existing ? and(ne(users.id, existing.id)) : undefined)
      .limit(1);
    if (other) return { outcome: 'others_exist' };

    if (existing?.status === 'active') return { outcome: 'already_active', userId: existing.id };
    if (existing?.status === 'deactivated') return { outcome: 'deactivated', userId: existing.id };
    if (existing) {
      await enqueueMail(tx, { kind: 'invitation', userId: existing.id });
      return { outcome: 'invited_again', userId: existing.id };
    }
    const [created] = await tx
      .insert(users)
      .values({ email: input.email, name: input.name, status: 'invited' })
      .returning({ id: users.id });
    await enqueueMail(tx, { kind: 'invitation', userId: created!.id });
    return { outcome: 'invited', userId: created!.id };
  });
}
