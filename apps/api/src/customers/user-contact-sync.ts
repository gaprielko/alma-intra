import { personName } from '@intra/shared/schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import { contacts, users } from '../db/schema/index.js';

/**
 * A contact made from a user follows the user, never the other way round
 * (docs/contacts-from-users.md, D-47). These are the fields it takes over.
 */
export const FOLLOWED_FIELDS = [
  'titleBefore',
  'firstName',
  'lastName',
  'titleAfter',
  'email',
  'phone',
] as const;

type FollowedValues = {
  titleBefore: string | null;
  firstName: string;
  lastName: string;
  titleAfter: string | null;
  email: string | null;
  phone: string | null;
};

export const followedOf = (person: FollowedValues): FollowedValues => ({
  titleBefore: person.titleBefore,
  firstName: person.firstName,
  lastName: person.lastName,
  titleAfter: person.titleAfter,
  email: person.email,
  phone: person.phone,
});

/** The forms send a value in their own format, which is no change: spaces and case do not count. */
const plain = (value: string | null | undefined) => (value ?? '').replace(/\s/g, '').toLowerCase();

/** The followed fields that differ between the two. */
export const followedChanges = (current: FollowedValues, next: FollowedValues) =>
  FOLLOWED_FIELDS.filter((field) => plain(current[field]) !== plain(next[field]));

/** `users.name` is one text: the last word is the last name, a single word stands for both. */
export function detailsOfUser(user: {
  name: string;
  titleBefore: string | null;
  titleAfter: string | null;
  email: string;
  phone: string | null;
}): FollowedValues {
  const words = user.name.trim().split(/\s+/);
  const lastName = words.at(-1)!;
  return {
    titleBefore: user.titleBefore,
    firstName: words.length > 1 ? words.slice(0, -1).join(' ') : lastName,
    lastName,
    titleAfter: user.titleAfter,
    email: user.email,
    phone: user.phone,
  };
}

/** Writes the user's details to their contact; a private person's record carries the name. */
export async function syncContactFromUser(tx: Db | Tx, userId: string) {
  const [user] = await tx
    .select({
      name: users.name,
      titleBefore: users.titleBefore,
      titleAfter: users.titleAfter,
      email: users.email,
      phone: users.phone,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return;
  const details = detailsOfUser(user);
  const [contact] = await tx
    .update(contacts)
    .set({ ...details, updatedAt: new Date() })
    .where(and(eq(contacts.userId, userId), isNull(contacts.deletedAt)))
    .returning({ id: contacts.id });
  if (!contact) return;
  await renameOwnRecord(tx, contact.id, details);
}

/** A private person's record is called as the person is. */
export async function renameOwnRecord(tx: Db | Tx, contactId: string, details: FollowedValues) {
  await tx.execute(sql`update organizations o set name = ${personName(details)}, updated_at = now()
    from contact_links l where l.organization_id = o.id and l.contact_id = ${contactId}
    and o.kind = 'individual'`);
}
