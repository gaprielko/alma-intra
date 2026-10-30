import { personName } from '@intra/shared/schemas';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import { contactLinks, contacts, users } from '../db/schema/index.js';

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

/**
 * Gives the contact the activities, e-mails and replies of the other removed contacts with its
 * e-mail. A campaign has one message for a person at an organization: another one stays where it is.
 */
async function mergeRemovedHistory(tx: Tx, contactId: string, email: string) {
  const removed = sql`(select id from contacts where lower(email) = ${email.toLowerCase()}
    and deleted_at is not null and id <> ${contactId})`;
  await tx.execute(sql`delete from activity_participants p where p.contact_id in ${removed}
    and exists (select 1 from activity_participants q
      where q.activity_id = p.activity_id and q.contact_id = ${contactId})`);
  await tx.execute(sql`delete from activity_participants p where p.contact_id in ${removed}
    and p.id not in (select distinct on (x.activity_id) x.id from activity_participants x
      where x.contact_id in ${removed} order by x.activity_id, x.id)`);
  await tx.execute(sql`update activity_participants set contact_id = ${contactId}
    where contact_id in ${removed}`);
  await tx.execute(sql`update campaign_messages set contact_id = ${contactId}
    where id in (select distinct on (x.campaign_id, x.organization_id) x.id
      from campaign_messages x where x.contact_id in ${removed}
      and not exists (select 1 from campaign_messages q where q.campaign_id = x.campaign_id
        and q.organization_id = x.organization_id and q.contact_id = ${contactId})
      order by x.campaign_id, x.organization_id, x.id)`);
  await tx.execute(sql`update inbound_messages set contact_id = ${contactId}
    where contact_id in ${removed}`);
}

/**
 * A new contact, or the removed one with the same e-mail back: the e-mail is the person, so the
 * history of all the removed contacts with it comes along (D-48). What was given wins and what was
 * not stays, a contact that unsubscribed stays unsubscribed, and one made from a user takes the
 * user's details.
 */
export async function insertOrRestoreContact(tx: Tx, values: typeof contacts.$inferInsert) {
  const [removed] = values.email
    ? await tx
        .select({ id: contacts.id, userId: contacts.userId })
        .from(contacts)
        .where(
          and(
            sql`lower(${contacts.email}) = ${values.email.toLowerCase()}`,
            isNotNull(contacts.deletedAt),
          ),
        )
        .orderBy(desc(contacts.deletedAt))
        .limit(1)
        .for('update')
    : [];
  if (!removed) {
    const [created] = await tx.insert(contacts).values(values).returning({ id: contacts.id });
    return { id: created!.id };
  }
  const given = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined),
  );
  const userId = values.userId ?? removed.userId;
  const [user] = userId ? await tx.select().from(users).where(eq(users.id, userId)) : [];
  await tx
    .update(contacts)
    .set({
      ...given,
      ...(user ? detailsOfUser(user) : {}),
      deletedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, removed.id));
  await mergeRemovedHistory(tx, removed.id, values.email!);
  return { id: removed.id };
}

/**
 * Writes the user's details to their contact; a private person's record carries the name. The
 * position belongs to each organization: it follows wherever it still is the user's previous one,
 * and one written by hand for an organization stays.
 */
export async function syncContactFromUser(
  tx: Db | Tx,
  userId: string,
  previousPosition: string | null,
) {
  const [user] = await tx
    .select({
      name: users.name,
      titleBefore: users.titleBefore,
      titleAfter: users.titleAfter,
      email: users.email,
      phone: users.phone,
      position: users.position,
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
  if (user.position !== previousPosition) {
    await tx
      .update(contactLinks)
      .set({ position: user.position })
      .where(
        and(
          eq(contactLinks.contactId, contact.id),
          sql`coalesce(${contactLinks.position}, '') = ${previousPosition ?? ''}`,
        ),
      );
  }
}

/** A private person's record is called as the person is. */
export async function renameOwnRecord(tx: Db | Tx, contactId: string, details: FollowedValues) {
  await tx.execute(sql`update organizations o set name = ${personName(details)}, updated_at = now()
    from contact_links l where l.organization_id = o.id and l.contact_id = ${contactId}
    and o.kind = 'individual'`);
}
