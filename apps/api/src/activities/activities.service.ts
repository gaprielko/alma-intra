import {
  type ActivityValues,
  COMPANY_ROOT_FOLDER_ID,
  personName,
  richTextToPlain,
  type TimelineFilter,
} from '@intra/shared/schemas';
import { type AnyColumn, and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/db.module.js';
import {
  activities,
  activityAttachments,
  activityParticipants,
  auditEvents,
  campaignMessages,
  campaigns,
  contactLinks,
  contacts,
  files,
  fileVersions,
  folders,
  fullNameOf,
  inboundMessages,
  messageAttachments,
  organizations,
  users,
} from '../db/schema/index.js';
import { customerHistory, familyOf, fileUnder } from '../customers/customers.service.js';
import type { Storage } from '../storage/storage.js';

/** A refusal the web words for itself (`sk.activities.errors`). */
export class ActivityError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'CUSTOMER_NOT_FOUND'
      | 'CONTACT_NOT_OF_CUSTOMER'
      | 'USER_NOT_FOUND'
      | 'FILE_NOT_FOUND'
      | 'STORAGE_NOT_CONFIGURED',
  ) {
    super(code);
  }
}

const alive = isNull(activities.deletedAt);
const PREVIEW_CHARS = 280;
const preview = (text: string | null) =>
  text && text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;

async function liveCustomer(tx: Db | Tx, customerId: string) {
  const [row] = await tx
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.id, customerId), isNull(organizations.deletedAt)));
  if (!row) throw new ActivityError('CUSTOMER_NOT_FOUND');
  return row;
}

/**
 * The contacts must be of the organization or one of its prevádzky (`familyIds`), the colleagues
 * must exist.
 */
async function checkParticipants(tx: Tx, familyIds: string[], input: ActivityValues) {
  const contactIds = [...new Set(input.contactIds)];
  const userIds = [...new Set(input.userIds)];
  if (contactIds.length > 0) {
    const found = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, contactIds),
          inArray(
            contacts.id,
            tx
              .select({ id: contactLinks.contactId })
              .from(contactLinks)
              .where(inArray(contactLinks.organizationId, familyIds)),
          ),
          isNull(contacts.deletedAt),
        ),
      );
    if (found.length !== contactIds.length) throw new ActivityError('CONTACT_NOT_OF_CUSTOMER');
  }
  const people = [...userIds, ...(input.nextStep?.assigneeId ? [input.nextStep.assigneeId] : [])];
  if (people.length > 0) {
    const found = await tx
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [...new Set(people)]));
    if (found.length !== new Set(people).size) throw new ActivityError('USER_NOT_FOUND');
  }
  return { contactIds, userIds };
}

/**
 * The versions the activity keeps: the one named, or the file's current version. A file in the
 * trash cannot be attached anew, but an attachment kept from before stays.
 */
async function resolveAttachments(
  tx: Tx,
  input: ActivityValues,
  kept: ReadonlySet<string> = new Set(),
) {
  const versionIds: string[] = [];
  for (const attachment of input.attachments) {
    const [file] = await tx
      .select({ currentVersionId: files.currentVersionId, deletedAt: files.deletedAt })
      .from(files)
      .where(and(eq(files.id, attachment.fileId), isNotNull(files.currentVersionId)));
    if (!file) throw new ActivityError('FILE_NOT_FOUND');
    const versionId = attachment.versionId ?? file.currentVersionId!;
    if (file.deletedAt && !kept.has(versionId)) throw new ActivityError('FILE_NOT_FOUND');
    const [version] = await tx
      .select({ id: fileVersions.id })
      .from(fileVersions)
      .where(
        and(
          eq(fileVersions.id, versionId),
          eq(fileVersions.fileId, attachment.fileId),
          eq(fileVersions.status, 'uploaded'),
        ),
      );
    if (!version) throw new ActivityError('FILE_NOT_FOUND');
    if (!versionIds.includes(version.id)) versionIds.push(version.id);
  }
  return versionIds;
}

/**
 * The row an activity belongs to (docs/establishments.md 7): the one picked in „Patrí k“, which
 * must be of the same organization; otherwise a prevádzka's own, or found from the persons.
 */
async function targetOf(
  tx: Tx,
  customerId: string,
  family: Awaited<ReturnType<typeof familyOf>>,
  picked: string | undefined,
  contactIds: string[],
) {
  if (picked) {
    if (!family.members.some((m) => m.id === picked)) throw new ActivityError('CUSTOMER_NOT_FOUND');
    return picked;
  }
  return customerId === family.headId ? fileUnder(tx, customerId, contactIds) : customerId;
}

function columnsOf(input: ActivityValues) {
  const bodyText = input.body ? richTextToPlain(input.body).trim() : '';
  return {
    kind: input.kind,
    occurredAt: input.occurredAt,
    durationMin: input.durationMin ?? null,
    subject: input.subject || null,
    body: bodyText ? input.body! : null,
    bodyText: bodyText || null,
    nextStepText: input.nextStep?.text ?? null,
    nextStepDue: input.nextStep?.due ?? null,
    nextStepUserId: input.nextStep?.assigneeId ?? null,
  };
}

async function writeLinks(
  tx: Tx,
  activityId: string,
  people: { contactIds: string[]; userIds: string[] },
  versionIds: string[],
) {
  await tx.delete(activityParticipants).where(eq(activityParticipants.activityId, activityId));
  const participants = [
    ...people.contactIds.map((contactId) => ({ activityId, contactId })),
    ...people.userIds.map((userId) => ({ activityId, userId })),
  ];
  if (participants.length > 0) await tx.insert(activityParticipants).values(participants);
  await tx.delete(activityAttachments).where(eq(activityAttachments.activityId, activityId));
  if (versionIds.length > 0) {
    await tx
      .insert(activityAttachments)
      .values(
        versionIds.map((fileVersionId, position) => ({ activityId, fileVersionId, position })),
      );
  }
}

export async function createActivity(
  db: Db,
  userId: string,
  customerId: string,
  input: ActivityValues,
) {
  return db.transaction(async (tx) => {
    await liveCustomer(tx, customerId);
    const family = await familyOf(tx, customerId);
    const people = await checkParticipants(
      tx,
      family.members.map((m) => m.id),
      input,
    );
    const organizationId = await targetOf(
      tx,
      customerId,
      family,
      input.organizationId,
      people.contactIds,
    );
    const versionIds = await resolveAttachments(tx, input);
    const [created] = await tx
      .insert(activities)
      .values({ ...columnsOf(input), organizationId, authorUserId: userId })
      .returning({ id: activities.id });
    await writeLinks(tx, created!.id, people, versionIds);
    return {
      id: created!.id,
      organizationId,
      contacts: people.contactIds.length,
      attachments: versionIds.length,
    };
  });
}

/** The names of the fields whose value changed, for the audit trail (never the values). */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(after)
    .filter((key) => {
      const a = before[key] ?? null;
      const b = after[key] ?? null;
      if (a instanceof Date || b instanceof Date) {
        return (a as Date | null)?.getTime() !== (b as Date | null)?.getTime();
      }
      return JSON.stringify(a) !== JSON.stringify(b);
    })
    .filter((key) => key !== 'bodyText')
    .sort();
}

export async function updateActivity(db: Db, id: string, input: ActivityValues) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, id), alive))
      .for('update');
    if (!current) throw new ActivityError('NOT_FOUND');
    await liveCustomer(tx, current.organizationId);
    const family = await familyOf(tx, current.organizationId);
    const people = await checkParticipants(
      tx,
      family.members.map((m) => m.id),
      input,
    );
    // Moving it between the organization and a prevádzka is an edit of „Patrí k“.
    const organizationId = input.organizationId
      ? await targetOf(tx, current.organizationId, family, input.organizationId, [])
      : current.organizationId;
    const keptRows = await tx
      .select({ id: activityAttachments.fileVersionId })
      .from(activityAttachments)
      .where(eq(activityAttachments.activityId, id));
    const versionIds = await resolveAttachments(tx, input, new Set(keptRows.map((row) => row.id)));
    const values = { ...columnsOf(input), organizationId };
    const fields = changedFields(current, values);
    // A next step taken away is no longer done either.
    const done = values.nextStepText ? {} : { nextStepDoneAt: null, nextStepDoneByUserId: null };
    await tx
      .update(activities)
      .set({ ...values, ...done, updatedAt: new Date() })
      .where(eq(activities.id, id));
    await writeLinks(tx, id, people, versionIds);
    return {
      customerId: organizationId,
      fields,
      contacts: people.contactIds.length,
      attachments: versionIds.length,
    };
  });
}

export async function deleteActivity(db: Db, id: string) {
  const [row] = await db
    .update(activities)
    .set({ deletedAt: new Date() })
    .where(and(eq(activities.id, id), alive))
    .returning({ customerId: activities.organizationId });
  if (!row) throw new ActivityError('NOT_FOUND');
  return row;
}

/** „Hotovo“ on a next step, or back to open. */
export async function setNextStepDone(db: Db, userId: string, id: string, done: boolean) {
  const [row] = await db
    .update(activities)
    .set(
      done
        ? { nextStepDoneAt: new Date(), nextStepDoneByUserId: userId }
        : { nextStepDoneAt: null, nextStepDoneByUserId: null },
    )
    .where(and(eq(activities.id, id), alive, isNotNull(activities.nextStepText)))
    .returning({ customerId: activities.organizationId });
  if (!row) throw new ActivityError('NOT_FOUND');
  return row;
}

const author = alias(users, 'author');
const assignee = alias(users, 'assignee');
const doneBy = alias(users, 'done_by');

/** Who took part, contacts first, by activity. */
async function participantsOf(db: Db, activityIds: string[]) {
  if (activityIds.length === 0) return new Map<string, Participant[]>();
  const rows = await db
    .select({
      activityId: activityParticipants.activityId,
      contactId: activityParticipants.contactId,
      userId: activityParticipants.userId,
      titleBefore: contacts.titleBefore,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      titleAfter: contacts.titleAfter,
      userName: users.name,
    })
    .from(activityParticipants)
    .leftJoin(contacts, eq(contacts.id, activityParticipants.contactId))
    .leftJoin(users, eq(users.id, activityParticipants.userId))
    .where(inArray(activityParticipants.activityId, activityIds))
    .orderBy(asc(activityParticipants.userId), asc(contacts.lastName));
  const map = new Map<string, Participant[]>();
  for (const row of rows) {
    const list = map.get(row.activityId) ?? [];
    list.push(
      row.contactId
        ? {
            kind: 'contact',
            id: row.contactId,
            name: personName({
              titleBefore: row.titleBefore,
              firstName: row.firstName ?? '',
              lastName: row.lastName ?? '',
              titleAfter: row.titleAfter,
            }),
          }
        : { kind: 'user', id: row.userId!, name: row.userName ?? '' },
    );
    map.set(row.activityId, list);
  }
  return map;
}

export interface Participant {
  kind: 'contact' | 'user';
  id: string;
  name: string;
}

/** An activity's sheet: everything, with the names of the people and the files. */
export async function getActivity(db: Db, id: string) {
  const [row] = await db
    .select({
      id: activities.id,
      customerId: activities.organizationId,
      customerName: organizations.name,
      kind: activities.kind,
      occurredAt: activities.occurredAt,
      durationMin: activities.durationMin,
      subject: activities.subject,
      body: activities.body,
      nextStepText: activities.nextStepText,
      nextStepDue: activities.nextStepDue,
      nextStepUserId: activities.nextStepUserId,
      nextStepUser: assignee.name,
      nextStepDoneAt: activities.nextStepDoneAt,
      nextStepDoneBy: doneBy.name,
      author: author.name,
      createdAt: activities.createdAt,
      updatedAt: activities.updatedAt,
    })
    .from(activities)
    .innerJoin(organizations, eq(organizations.id, activities.organizationId))
    .leftJoin(author, eq(author.id, activities.authorUserId))
    .leftJoin(assignee, eq(assignee.id, activities.nextStepUserId))
    .leftJoin(doneBy, eq(doneBy.id, activities.nextStepDoneByUserId))
    .where(and(eq(activities.id, id), alive, isNull(organizations.deletedAt)));
  if (!row) throw new ActivityError('NOT_FOUND');
  const participants = (await participantsOf(db, [id])).get(id) ?? [];
  const attachments = await db
    .select({
      fileId: files.id,
      versionId: fileVersions.id,
      name: files.name,
      number: fileVersions.number,
      size: fileVersions.size,
      current: sql<boolean>`${files.currentVersionId} = ${fileVersions.id}`,
      trashed: sql<boolean>`${files.deletedAt} is not null`,
    })
    .from(activityAttachments)
    .innerJoin(fileVersions, eq(fileVersions.id, activityAttachments.fileVersionId))
    .innerJoin(files, eq(files.id, fileVersions.fileId))
    .where(eq(activityAttachments.activityId, id))
    .orderBy(asc(activityAttachments.position));
  return { ...row, participants, attachments };
}

/** The activity's audit events, newest first. */
export async function activityHistory(db: Db, id: string) {
  return db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      action: auditEvents.action,
      userName: users.name,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.userId))
    .where(
      and(
        eq(auditEvents.entityType, 'activity'),
        eq(auditEvents.entityId, id),
        sql`${auditEvents.action} not like '%.failed' and ${auditEvents.action} not like '%.denied'`,
      ),
    )
    .orderBy(desc(auditEvents.at))
    .limit(50);
}

const TIMELINE_LIMIT = 100;

/**
 * The customer's timeline, newest first: activities and notes, the e-mails sent and received,
 * and the changes from the audit trail.
 */
export async function timeline(
  db: Db,
  customerId: string,
  filter: TimelineFilter,
  withEstablishments = false,
) {
  await liveCustomer(db, customerId);
  // An organization's timeline may carry its prevádzky' entries too (P-7); a prevádzka's, its own.
  const family = await familyOf(db, customerId);
  const customerIds =
    withEstablishments && family.headId === customerId
      ? family.members.map((m) => m.id)
      : [customerId];
  return timelineOf(db, { customerIds }, filter);
}

/**
 * The timeline of an organization, or of one person (D-8): only the activities they took part in,
 * the e-mails sent to them and their replies, from all their organizations, each item naming its
 * organization. A person's changes are not in it.
 */
export async function timelineOf(
  db: Db,
  scope: { customerIds: string[] } | { contactId: string },
  filter: TimelineFilter,
) {
  const customerIds = 'customerIds' in scope ? scope.customerIds : null;
  const contactId = 'contactId' in scope ? scope.contactId : null;
  const activityScope = customerIds
    ? inArray(activities.organizationId, customerIds)
    : sql`exists (select 1 from activity_participants p
        where p.activity_id = ${activities.id} and p.contact_id = ${contactId})`;
  const kindFilter =
    filter === 'notes'
      ? [eq(activities.kind, 'note')]
      : filter === 'activities'
        ? [sql`${activities.kind} <> 'note'`]
        : [];
  const wantsActivities = filter === 'all' || filter === 'activities' || filter === 'notes';
  const rows = wantsActivities
    ? await db
        .select({
          id: activities.id,
          kind: activities.kind,
          occurredAt: activities.occurredAt,
          durationMin: activities.durationMin,
          subject: activities.subject,
          bodyText: activities.bodyText,
          nextStepText: activities.nextStepText,
          nextStepDue: activities.nextStepDue,
          nextStepDoneAt: activities.nextStepDoneAt,
          author: author.name,
          attachmentCount: sql<number>`(select count(*)::int from activity_attachments aa
            where aa.activity_id = "activities"."id")`,
          organization: organizationJson(activities.organizationId),
        })
        .from(activities)
        .leftJoin(author, eq(author.id, activities.authorUserId))
        .where(and(activityScope, alive, ...kindFilter))
        .orderBy(desc(activities.occurredAt))
        .limit(TIMELINE_LIMIT)
    : [];
  const participants = await participantsOf(
    db,
    rows.map((row) => row.id),
  );
  const items = [
    ...rows.map((row) => ({
      type: 'activity' as const,
      at: row.occurredAt,
      activity: {
        ...row,
        bodyText: preview(row.bodyText),
        participants: participants.get(row.id) ?? [],
      },
    })),
    ...(filter === 'all' || filter === 'emails'
      ? (
          await db
            .select({
              id: campaignMessages.id,
              campaignId: campaignMessages.campaignId,
              subject: campaignMessages.subject,
              status: campaignMessages.status,
              toName: campaignMessages.toName,
              at: sql<Date>`coalesce(${campaignMessages.sentAt}, ${campaignMessages.queuedAt})`,
              sender: fullNameOf(users),
              organization: organizationJson(campaignMessages.organizationId),
            })
            .from(campaignMessages)
            .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
            .innerJoin(users, eq(users.id, campaigns.senderUserId))
            .where(
              and(
                customerIds
                  ? inArray(campaignMessages.organizationId, customerIds)
                  : eq(campaignMessages.contactId, contactId!),
                isNotNull(campaignMessages.queuedAt),
              ),
            )
            .orderBy(desc(campaignMessages.queuedAt))
            .limit(TIMELINE_LIMIT)
        ).map((email) => ({ type: 'email' as const, at: email.at, email }))
      : []),
    ...(filter === 'all' || filter === 'emails'
      ? (
          await db
            .select({
              id: inboundMessages.id,
              fromName: inboundMessages.fromName,
              fromEmail: inboundMessages.fromEmail,
              subject: inboundMessages.subject,
              preview: sql<string>`left(regexp_replace(coalesce(${inboundMessages.text}, ''),
                '\\s+', ' ', 'g'), 200)`,
              at: inboundMessages.receivedAt,
              attachmentCount: sql<number>`jsonb_array_length(${inboundMessages.attachments})`,
              organization: organizationJson(inboundMessages.organizationId),
            })
            .from(inboundMessages)
            .where(
              and(
                customerIds
                  ? inArray(inboundMessages.organizationId, customerIds)
                  : eq(inboundMessages.contactId, contactId!),
                eq(inboundMessages.status, 'assigned'),
              ),
            )
            .orderBy(desc(inboundMessages.receivedAt))
            .limit(TIMELINE_LIMIT)
        ).map((reply) => ({ type: 'reply' as const, at: reply.at, reply }))
      : []),
    ...(customerIds && (filter === 'all' || filter === 'changes')
      ? (
          await Promise.all(
            (
              await db
                .select({ id: organizations.id, name: organizations.name })
                .from(organizations)
                .where(inArray(organizations.id, customerIds))
            ).map(async (organization) =>
              (await customerHistory(db, organization.id)).map((event) => ({
                ...event,
                organization,
              })),
            ),
          )
        )
          .flat()
          // A download of the CSV is not news about the customer.
          .filter((event) => event.diff?.exported !== true)
          .map((event) => ({ type: 'change' as const, at: event.at, change: event }))
      : []),
  ];
  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, TIMELINE_LIMIT);
}

/** The organization a timeline item belongs to, for a person's timeline that spans several. */
const organizationJson = (column: AnyColumn) =>
  sql<{ id: string; name: string; role: 'customer' | 'partner' } | null>`(select
    json_build_object('id', o.id, 'name', o.name, 'role', o.role)
    from organizations o where o.id = ${column})`;

/** „Moje ďalšie kroky“: the open next steps of one person, the ones due first. */
export async function myNextSteps(db: Db, userId: string) {
  return db
    .select({
      id: activities.id,
      text: sql<string>`${activities.nextStepText}`,
      due: activities.nextStepDue,
      kind: activities.kind,
      occurredAt: activities.occurredAt,
      customerId: organizations.id,
      customerName: organizations.name,
    })
    .from(activities)
    .innerJoin(organizations, eq(organizations.id, activities.organizationId))
    .where(
      and(
        eq(activities.nextStepUserId, userId),
        isNotNull(activities.nextStepText),
        isNull(activities.nextStepDoneAt),
        alive,
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(sql`${activities.nextStepDue} asc nulls last`, asc(activities.occurredAt))
    .limit(50);
}

/**
 * The colleagues and the persons of the organization and its prevádzky, each with where they are,
 * for the participants and the assignee; and where the activity may belong („Patrí k“).
 */
export async function activityOptions(db: Db, customerId: string) {
  await liveCustomer(db, customerId);
  const family = await familyOf(db, customerId);
  const [links, colleagues] = await Promise.all([
    db
      .select({
        id: contacts.id,
        titleBefore: contacts.titleBefore,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        titleAfter: contacts.titleAfter,
        position: contactLinks.position,
        organizationId: contactLinks.organizationId,
        isPrimary: contactLinks.isPrimary,
      })
      .from(contactLinks)
      .innerJoin(contacts, eq(contacts.id, contactLinks.contactId))
      .where(
        and(
          inArray(
            contactLinks.organizationId,
            family.members.map((m) => m.id),
          ),
          isNull(contacts.deletedAt),
        ),
      )
      .orderBy(desc(contactLinks.isPrimary), asc(contacts.lastName)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.status, 'active'))
      .orderBy(asc(users.name)),
  ]);
  // One row per person: the position where this page's customer has them, else the first one.
  const byId = new Map<
    string,
    { id: string; name: string; position: string | null; places: string[]; here: boolean }
  >();
  for (const link of links) {
    const known = byId.get(link.id);
    const here = link.organizationId === customerId;
    if (known) {
      known.places.push(link.organizationId);
      if (here) Object.assign(known, { position: link.position, here });
    } else {
      byId.set(link.id, {
        id: link.id,
        name: personName(link),
        position: link.position,
        places: [link.organizationId],
        here,
      });
    }
  }
  // This page's own persons first.
  const people = [...byId.values()].sort((a, b) => Number(b.here) - Number(a.here));
  return {
    contacts: people.map(({ id, name, position, places }) => ({ id, name, position, places })),
    users: colleagues,
    headId: family.headId,
    holders: family.members,
  };
}

const PICKER_LIMIT = 200;

/**
 * Files to attach: the customer's folders or the company's, live, newest first, with the folder
 * each is in.
 */
export async function pickableFiles(
  db: Db,
  scope: 'customer' | 'company',
  customerId: string | undefined,
  search: string | undefined,
) {
  if (customerId) await liveCustomer(db, customerId);
  else if (scope === 'customer') throw new ActivityError('CUSTOMER_NOT_FOUND');
  const where = [
    isNull(files.deletedAt),
    scope === 'customer' ? eq(folders.organizationId, customerId!) : isNull(folders.organizationId),
  ];
  if (search) {
    where.push(sql`${files.name} ilike ${`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  }
  const [root] =
    scope === 'customer'
      ? await db
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.organizationId, customerId!), isNull(folders.parentId)))
      : [{ id: COMPANY_ROOT_FOLDER_ID }];
  const rows = await db
    .select({
      id: files.id,
      name: files.name,
      folderName: sql<string>`coalesce(${folders.name}, ${organizations.name})`,
      size: fileVersions.size,
      version: sql<number>`${fileVersions.number}`,
      changedAt: fileVersions.createdAt,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .innerJoin(folders, eq(folders.id, files.folderId))
    .leftJoin(organizations, eq(organizations.id, folders.organizationId))
    .where(and(...where))
    .orderBy(desc(fileVersions.createdAt))
    .limit(PICKER_LIMIT);
  return { rootId: root?.id ?? null, files: rows };
}

/**
 * A signed GET of an attached version, through the activity: it stays readable even after the
 * file was replaced or moved to the trash.
 */
export async function attachmentUrl(
  db: Db,
  storage: Storage | null,
  activityId: string,
  versionId: string,
  inline: boolean,
) {
  const [row] = await db
    .select({
      storageKey: fileVersions.storageKey,
      mime: fileVersions.mime,
      name: files.name,
      fileId: files.id,
    })
    .from(activityAttachments)
    .innerJoin(activities, eq(activities.id, activityAttachments.activityId))
    .innerJoin(fileVersions, eq(fileVersions.id, activityAttachments.fileVersionId))
    .innerJoin(files, eq(files.id, fileVersions.fileId))
    .where(
      and(
        eq(activityAttachments.activityId, activityId),
        eq(activityAttachments.fileVersionId, versionId),
        alive,
      ),
    );
  if (!row) throw new ActivityError('NOT_FOUND');
  if (!storage) throw new ActivityError('STORAGE_NOT_CONFIGURED');
  const signed = await storage.createDownloadUrl(row.storageKey, {
    fileName: row.name,
    contentType: row.mime,
    inline,
  });
  return { url: signed.url, fileId: row.fileId };
}

/**
 * „Kde je použitý“: the activities that keep a version of the file and the e-mails that carried
 * one (one row per e-mail, with how many it went to), newest first.
 */
export async function fileUsage(db: Db, fileId: string) {
  const [used, sent] = await Promise.all([activityUsage(db, fileId), emailUsage(db, fileId)]);
  return [
    ...used.map((row) => ({ type: 'activity' as const, at: row.occurredAt, ...row })),
    ...sent.map((row) => ({ type: 'email' as const, at: row.sentAt, ...row })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** The e-mails that carried a version of the file, one row each. */
function emailUsage(db: Db, fileId: string) {
  return db
    .select({
      campaignId: campaigns.id,
      subject: campaigns.subjectText,
      sentAt: sql<Date>`max(${campaignMessages.sentAt})`,
      recipients: sql<number>`count(distinct ${campaignMessages.id})`.mapWith(Number),
      version: sql<number>`max(${fileVersions.number})`,
    })
    .from(messageAttachments)
    .innerJoin(fileVersions, eq(fileVersions.id, messageAttachments.fileVersionId))
    .innerJoin(campaignMessages, eq(campaignMessages.id, messageAttachments.messageId))
    .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
    .where(and(eq(fileVersions.fileId, fileId), isNotNull(campaignMessages.sentAt)))
    .groupBy(campaigns.id)
    .orderBy(desc(sql`max(${campaignMessages.sentAt})`))
    .limit(50);
}

function activityUsage(db: Db, fileId: string) {
  return db
    .select({
      activityId: activities.id,
      kind: activities.kind,
      subject: activities.subject,
      occurredAt: activities.occurredAt,
      customerId: organizations.id,
      customerName: organizations.name,
      version: sql<number>`${fileVersions.number}`,
    })
    .from(activityAttachments)
    .innerJoin(fileVersions, eq(fileVersions.id, activityAttachments.fileVersionId))
    .innerJoin(activities, eq(activities.id, activityAttachments.activityId))
    .innerJoin(organizations, eq(organizations.id, activities.organizationId))
    .where(and(eq(fileVersions.fileId, fileId), alive, isNull(organizations.deletedAt)))
    .orderBy(desc(activities.occurredAt))
    .limit(50);
}

/**
 * Reminds each assignee of their next steps due by `today` (a local date, YYYY-MM-DD) in the
 * bell, once per due date: the claim and the reminder are one statement, so two runs never
 * remind twice.
 */
export async function remindDueNextSteps(db: Db, today: string) {
  const due = await db.execute<{ count: number }>(sql`
    with claimed as (
      update activities a set next_step_reminded_for = a.next_step_due
      where a.next_step_text is not null and a.next_step_done_at is null
        and a.deleted_at is null and a.next_step_user_id is not null
        and a.next_step_due <= ${today}::date
        and a.next_step_reminded_for is distinct from a.next_step_due
        and exists (select 1 from organizations c where c.id = a.organization_id and c.deleted_at is null)
        and exists (select 1 from users u where u.id = a.next_step_user_id and u.status = 'active')
      returning a.id, a.organization_id, a.next_step_user_id, a.next_step_text
    ), notified as (
      insert into notifications (user_id, kind, ref_id, organization_id, subject)
      select next_step_user_id, 'next_step', id, organization_id, next_step_text from claimed
      returning 1
    )
    select count(*)::int as count from notified`);
  return due.rows[0]?.count ?? 0;
}
