import { personListSchema, personName } from '@intra/shared/schemas';
import type { AddUserContactInput, PersonInput, PersonListInput } from '@intra/shared/schemas';
import { and, asc, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import { contactLinks, contacts, fullNameOf, organizations, users } from '../db/schema/index.js';
import { CustomerError } from './customers.service.js';
import {
  detailsOfUser,
  followedChanges,
  followedOf,
  renameOwnRecord,
} from './user-contact-sync.js';

/**
 * Kontakty: natural persons on their own (docs/contacts-redesign.md, stage O3). A person works at
 * any number of organizations, with a position at each; an e-mail is one live person (D-7).
 */

/** The object without one key, for a row that must not leave the server whole. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

const PERSON_ID = sql.raw('"contacts"."id"');
const alive = isNull(contacts.deletedAt);
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The last activity the person took part in, e-mail sent to them or reply received from them. */
const LAST_CONTACT = sql`greatest(
  (select max(a.occurred_at) from activities a join activity_participants p on p.activity_id = a.id
    where p.contact_id = ${PERSON_ID} and a.deleted_at is null),
  (select max(m.sent_at) from campaign_messages m where m.contact_id = ${PERSON_ID}),
  (select max(i.received_at) from inbound_messages i
    where i.contact_id = ${PERSON_ID} and i.status = 'assigned'))`;

/** The person's live organizations with their position there, the primary ones first. */
const organizationsJson = sql<
  {
    id: string;
    name: string;
    role: 'customer' | 'partner';
    kind: 'organization' | 'individual';
    position: string | null;
    isPrimary: boolean;
    /** At a prevádzka: its organization's name. */
    parentName: string | null;
  }[]
>`coalesce((select json_agg(json_build_object('id', o.id, 'name', o.name, 'role', o.role,
    'kind', o.kind, 'position', l.position, 'isPrimary', l.is_primary, 'parentName', h.name)
    order by l.is_primary desc, coalesce(h.name, o.name) collate "sk-x-icu", o.name collate "sk-x-icu")
  from contact_links l join organizations o on o.id = l.organization_id
  left join organizations h on h.id = o.parent_id
  where l.contact_id = ${PERSON_ID} and o.deleted_at is null), '[]'::json)`;

function filterWhere(input: ReturnType<typeof personListSchema.parse>): SQL[] {
  const where: SQL[] = [alive];
  const linkExists = (role: 'customer' | 'partner') =>
    sql`exists (select 1 from contact_links l join organizations o on o.id = l.organization_id
      where l.contact_id = ${PERSON_ID} and o.deleted_at is null and o.role = ${role})`;
  if (input.link) {
    const parts = input.link.map((link) =>
      link === 'none'
        ? sql`not exists (select 1 from contact_links l join organizations o on o.id = l.organization_id
            where l.contact_id = ${PERSON_ID} and o.deleted_at is null)`
        : linkExists(link),
    );
    where.push(sql`(${sql.join(parts, sql` or `)})`);
  }
  if (input.organizationId) {
    where.push(
      // An organization's persons and those of its prevádzky.
      sql`exists (select 1 from contact_links l join organizations o on o.id = l.organization_id
        where l.contact_id = ${PERSON_ID} and (o.id in (${sql.join(
          input.organizationId.map((id) => sql`${id}`),
          sql`, `,
        )}) or o.parent_id in (${sql.join(
          input.organizationId.map((id) => sql`${id}`),
          sql`, `,
        )})))`,
    );
  }
  if (input.emailState) {
    const parts = input.emailState.map((state) =>
      state === 'unsubscribed'
        ? sql`${contacts.unsubscribedAt} is not null`
        : sql`${contacts.emailStatus} <> 'ok'`,
    );
    where.push(sql`(${sql.join(parts, sql` or `)})`);
  }
  if (input.search) {
    const pattern = likePattern(input.search);
    where.push(sql`(unaccent(${contacts.firstName} || ' ' || ${contacts.lastName}) ilike unaccent(${pattern})
      or ${contacts.email} ilike ${pattern}
      or replace(coalesce(${contacts.phone}, ''), ' ', '') like ${likePattern(input.search.replace(/\s/g, ''))}
      or exists (select 1 from contact_links l join organizations o on o.id = l.organization_id
        where l.contact_id = ${PERSON_ID} and unaccent(o.name) ilike unaccent(${pattern})))`);
  }
  return where;
}

/** One page of Kontakty, with how many work at customers, at partners and nowhere. */
export async function listPersons(db: Db | Tx, raw: PersonListInput) {
  const input = personListSchema.parse(raw);
  const where = filterWhere(input);
  const dir = input.dir === 'desc' ? 'desc' : 'asc';
  const order =
    input.sort === 'lastContact'
      ? sql`${LAST_CONTACT} ${sql.raw(dir)} nulls last`
      : sql`${contacts.lastName} collate "sk-x-icu" ${sql.raw(dir)}, ${contacts.firstName} collate "sk-x-icu" ${sql.raw(dir)}`;
  const counted = filterWhere({ ...input, link: undefined });
  const [rows, [counts]] = await Promise.all([
    db
      .select({
        id: contacts.id,
        titleBefore: contacts.titleBefore,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        titleAfter: contacts.titleAfter,
        email: contacts.email,
        phone: contacts.phone,
        emailStatus: contacts.emailStatus,
        unsubscribedAt: contacts.unsubscribedAt,
        organizations: organizationsJson,
        lastContactAt: sql<string | null>`${LAST_CONTACT}`,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(contacts)
      .where(and(...where))
      .orderBy(order, asc(contacts.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({
        all: sql<number>`count(*)`.mapWith(Number),
        customer: sql<number>`count(*) filter (where exists (select 1 from contact_links l
          join organizations o on o.id = l.organization_id where l.contact_id = ${PERSON_ID}
          and o.deleted_at is null and o.role = 'customer'))`.mapWith(Number),
        partner: sql<number>`count(*) filter (where exists (select 1 from contact_links l
          join organizations o on o.id = l.organization_id where l.contact_id = ${PERSON_ID}
          and o.deleted_at is null and o.role = 'partner'))`.mapWith(Number),
        none: sql<number>`count(*) filter (where not exists (select 1 from contact_links l
          join organizations o on o.id = l.organization_id where l.contact_id = ${PERSON_ID}
          and o.deleted_at is null))`.mapWith(Number),
      })
      .from(contacts)
      .where(and(...counted)),
  ]);
  return {
    items: rows.map((row) => ({ ...omit(row, 'total'), name: personName(row) })),
    total: rows[0]?.total ?? 0,
    page: input.page,
    pageSize: input.pageSize,
    counts: counts ?? { all: 0, customer: 0, partner: 0, none: 0 },
  };
}

/** A live person with their organizations. */
export async function getPerson(db: Db | Tx, id: string) {
  const [row] = await db
    .select({ person: contacts, organizations: organizationsJson })
    .from(contacts)
    .where(and(eq(contacts.id, id), alive));
  if (!row) throw new CustomerError('NOT_FOUND');
  const person = omit(row.person, 'deletedAt');
  return { ...person, name: personName(person), organizations: row.organizations };
}

/** Who has the address, if anybody: the form offers that person instead of a second one. */
export async function personByEmail(db: Db | Tx, email: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(sql`lower(${contacts.email}) = ${email.toLowerCase()}`, alive));
  return row ? getPerson(db, row.id) : null;
}

function personColumns(input: PersonInput) {
  return {
    titleBefore: input.titleBefore ?? null,
    firstName: input.firstName,
    lastName: input.lastName,
    titleAfter: input.titleAfter ?? null,
    gender: input.gender ?? null,
    salutation: input.salutation ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    note: input.note ?? null,
  };
}

const isEmailClash = (error: unknown) => {
  const e = error as { constraint?: string; cause?: { constraint?: string } } | null;
  return (e?.constraint ?? e?.cause?.constraint) === 'contacts_email_unique';
};

async function mapEmailClash<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isEmailClash(error)) throw new CustomerError('CONTACT_EMAIL_TAKEN');
    throw error;
  }
}

async function liveOrganization(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: organizations.id, kind: organizations.kind })
    .from(organizations)
    .where(and(eq(organizations.id, id), isNull(organizations.deletedAt)))
    .for('update');
  if (!row) throw new CustomerError('NOT_FOUND');
  // A private person's record has its own person only.
  if (row.kind !== 'organization') throw new CustomerError('NOT_ORGANIZATION');
}

/**
 * Puts the person at the organization (or updates their position there). As its primary contact,
 * or as the first person there, they take the place of the one before.
 */
async function link(
  tx: Tx,
  contactId: string,
  link: { customerId: string; position?: string | undefined; isPrimary: boolean },
) {
  await liveOrganization(tx, link.customerId);
  const [primary] = await tx
    .select({ id: contactLinks.contactId })
    .from(contactLinks)
    .innerJoin(contacts, eq(contacts.id, contactLinks.contactId))
    .where(
      and(
        eq(contactLinks.organizationId, link.customerId),
        eq(contactLinks.isPrimary, true),
        alive,
      ),
    );
  const isPrimary = link.isPrimary || !primary || primary.id === contactId;
  if (isPrimary && primary && primary.id !== contactId) {
    await tx
      .update(contactLinks)
      .set({ isPrimary: false })
      .where(
        and(eq(contactLinks.organizationId, link.customerId), eq(contactLinks.isPrimary, true)),
      );
  }
  const values = { position: link.position ?? null, isPrimary };
  await tx
    .insert(contactLinks)
    .values({ contactId, organizationId: link.customerId, ...values })
    .onConflictDoUpdate({
      target: [contactLinks.contactId, contactLinks.organizationId],
      set: values,
    });
  await tx
    .update(organizations)
    .set({ updatedAt: new Date() })
    .where(eq(organizations.id, link.customerId));
}

/** Takes the person off the organization; the person there the longest becomes primary. */
async function unlink(tx: Tx, contactId: string, customerId: string) {
  const [gone] = await tx
    .delete(contactLinks)
    .where(and(eq(contactLinks.contactId, contactId), eq(contactLinks.organizationId, customerId)))
    .returning({ isPrimary: contactLinks.isPrimary });
  if (!gone) throw new CustomerError('NOT_FOUND');
  if (gone.isPrimary) {
    const [next] = await tx
      .select({ id: contactLinks.contactId })
      .from(contactLinks)
      .innerJoin(contacts, eq(contacts.id, contactLinks.contactId))
      .where(and(eq(contactLinks.organizationId, customerId), alive))
      .orderBy(asc(contactLinks.createdAt))
      .limit(1);
    if (next) {
      await tx
        .update(contactLinks)
        .set({ isPrimary: true })
        .where(
          and(eq(contactLinks.contactId, next.id), eq(contactLinks.organizationId, customerId)),
        );
    }
  }
  await tx
    .update(organizations)
    .set({ updatedAt: new Date() })
    .where(eq(organizations.id, customerId));
}

/** A new person, at the organizations given (none is fine, D-2). */
export async function createPerson(
  db: Db,
  input: {
    person: PersonInput;
    receivesBulk: boolean;
    links: { customerId: string; position?: string | undefined; isPrimary: boolean }[];
  },
) {
  return mapEmailClash(() =>
    db.transaction(async (tx) => {
      const unsubscribed = input.receivesBulk
        ? {}
        : { unsubscribedAt: new Date(), unsubscribeSource: 'manual' as const };
      const [created] = await tx
        .insert(contacts)
        .values({ ...personColumns(input.person), ...unsubscribed })
        .returning({ id: contacts.id });
      const seen = new Set<string>();
      for (const item of input.links) {
        if (seen.has(item.customerId)) continue;
        seen.add(item.customerId);
        await link(tx, created!.id, item);
      }
      return { id: created!.id, customerIds: [...seen] };
    }),
  );
}

/** The person's own data; which fields changed, by name. */
export async function updatePerson(db: Db, id: string, input: PersonInput, receivesBulk: boolean) {
  return mapEmailClash(() =>
    db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), alive))
        .for('update');
      if (!current) throw new CustomerError('NOT_FOUND');
      const typed = personColumns(input);
      if (current.userId && followedChanges(current, typed).length > 0) {
        throw new CustomerError('FOLLOWS_USER');
      }
      const values = current.userId ? { ...typed, ...followedOf(current) } : typed;
      const fields: string[] = (Object.keys(values) as (keyof typeof values)[]).filter(
        (key) => (current[key] ?? null) !== (values[key] ?? null),
      );
      if (receivesBulk === (current.unsubscribedAt !== null)) fields.push('receivesBulk');
      const unsubscribe = receivesBulk
        ? { unsubscribedAt: null, unsubscribeSource: null }
        : current.unsubscribedAt
          ? {}
          : { unsubscribedAt: new Date(), unsubscribeSource: 'manual' as const };
      await tx
        .update(contacts)
        .set({ ...values, ...unsubscribe, updatedAt: new Date() })
        .where(eq(contacts.id, id));
      await renameOwnRecord(tx, id, values);
      return { fields: fields.sort() };
    }),
  );
}

async function livePerson(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, id), alive))
    .for('update');
  if (!row) throw new CustomerError('NOT_FOUND');
}

export async function linkPerson(
  db: Db,
  id: string,
  item: { customerId: string; position?: string | undefined; isPrimary: boolean },
) {
  return db.transaction(async (tx) => {
    await livePerson(tx, id);
    await link(tx, id, item);
  });
}

/**
 * The users „Používateľ aplikácie“ offers for an organization, and what adding each would do: put
 * their contact here, or connect the contact that already has their e-mail (D-47).
 */
export async function userCandidates(db: Db | Tx, customerId: string) {
  const rows = await db
    .select({
      id: users.id,
      fullName: fullNameOf(users),
      name: users.name,
      titleBefore: users.titleBefore,
      titleAfter: users.titleAfter,
      email: users.email,
      phone: users.phone,
      position: users.position,
      status: users.status,
    })
    .from(users)
    .where(and(isNull(users.deletedAt), ne(users.status, 'deactivated')))
    .orderBy(sql`${users.name} collate "sk-x-icu"`, asc(users.id));
  if (rows.length === 0) return [];
  const people = await db
    .select()
    .from(contacts)
    .where(
      and(
        alive,
        or(
          inArray(
            contacts.userId,
            rows.map((row) => row.id),
          ),
          inArray(
            sql`lower(${contacts.email})`,
            rows.map((row) => row.email.toLowerCase()),
          ),
        ),
      ),
    );
  const links = people.length
    ? await db
        .select({ contactId: contactLinks.contactId, organizationId: contactLinks.organizationId })
        .from(contactLinks)
        .innerJoin(organizations, eq(organizations.id, contactLinks.organizationId))
        .where(
          and(
            inArray(
              contactLinks.contactId,
              people.map((person) => person.id),
            ),
            isNull(organizations.deletedAt),
          ),
        )
    : [];
  const linksOf = (contactId: string) => links.filter((l) => l.contactId === contactId);
  return rows.map((row) => {
    const own = people.find((person) => person.userId === row.id);
    const sameEmail = own
      ? undefined
      : people.find((person) => person.email?.toLowerCase() === row.email.toLowerCase());
    const details = detailsOfUser(row);
    const contact = own ?? sameEmail;
    return {
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      position: row.position,
      status: row.status,
      /** The contact they already are, wherever it works. */
      contactId: own?.id ?? null,
      /** They already are a contact of this organization, there is nothing to add. */
      alreadyHere: contact
        ? linksOf(contact.id).some((l) => l.organizationId === customerId)
        : false,
      /** Their e-mail belongs to a contact not yet connected: what connecting it would change. */
      clash: sameEmail
        ? {
            name: personName(sameEmail),
            organizations: linksOf(sameEmail.id).length,
            changes: followedChanges(sameEmail, details).map((field) => ({
              field,
              from: sameEmail[field],
              to: details[field],
            })),
          }
        : null,
    };
  });
}

/**
 * Makes the user a contact of the organization. A user who already is a contact is not made
 * twice. A contact with their e-mail is connected only when the dialog has shown what changes.
 */
export async function addUserContact(db: Db, input: AddUserContactInput) {
  return mapEmailClash(() =>
    db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          status: users.status,
          name: users.name,
          titleBefore: users.titleBefore,
          titleAfter: users.titleAfter,
          email: users.email,
          phone: users.phone,
        })
        .from(users)
        .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
        .for('update');
      if (!user) throw new CustomerError('NOT_FOUND');
      if (user.status === 'deactivated') throw new CustomerError('USER_NOT_AVAILABLE');
      const details = detailsOfUser(user);
      const [own] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.userId, input.userId), alive))
        .for('update');
      let id = own?.id;
      if (!id) {
        const [sameEmail] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(sql`lower(${contacts.email}) = ${user.email.toLowerCase()}`, alive))
          .for('update');
        if (sameEmail && !input.connect) throw new CustomerError('CONTACT_EMAIL_TAKEN');
        if (sameEmail) {
          id = sameEmail.id;
          await tx
            .update(contacts)
            .set({ ...details, userId: input.userId, updatedAt: new Date() })
            .where(eq(contacts.id, id));
          await renameOwnRecord(tx, id, details);
        } else {
          const [created] = await tx
            .insert(contacts)
            .values({ ...details, userId: input.userId })
            .returning({ id: contacts.id });
          id = created!.id;
        }
      }
      await link(tx, id, input);
      return { id };
    }),
  );
}

/** Makes it an ordinary contact that keeps its details. */
export async function disconnectUser(db: Db, id: string) {
  const [row] = await db
    .update(contacts)
    .set({ userId: null, updatedAt: new Date() })
    .where(and(eq(contacts.id, id), alive))
    .returning({ id: contacts.id });
  if (!row) throw new CustomerError('NOT_FOUND');
}

/** Takes the person off one organization; they stay in Kontakty (D-2). */
export async function unlinkPerson(db: Db, id: string, customerId: string) {
  return db.transaction(async (tx) => {
    await livePerson(tx, id);
    const [own] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, customerId), eq(organizations.kind, 'individual')));
    // A private person's record cannot lose its person.
    if (own) throw new CustomerError('NOT_ORGANIZATION');
    await unlink(tx, id, customerId);
  });
}

/**
 * Removes the person (soft) and takes them off every organization. A private person goes with
 * their record only: deleting the record is the way.
 */
export async function deletePerson(db: Db, id: string) {
  return db.transaction(async (tx) => {
    await livePerson(tx, id);
    const links = await tx
      .select({ customerId: contactLinks.organizationId, kind: organizations.kind })
      .from(contactLinks)
      .innerJoin(organizations, eq(organizations.id, contactLinks.organizationId))
      .where(eq(contactLinks.contactId, id));
    if (links.some((l) => l.kind === 'individual')) throw new CustomerError('NOT_ORGANIZATION');
    for (const l of links) await unlink(tx, id, l.customerId);
    await tx
      .update(contacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(contacts.id, id));
    return { customerIds: links.map((l) => l.customerId) };
  });
}
