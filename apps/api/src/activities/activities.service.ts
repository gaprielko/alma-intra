import {
  type ActivityValues,
  COMPANY_ROOT_FOLDER_ID,
  personName,
  richTextToPlain,
  type TimelineFilter,
} from '@intra/shared/schemas';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/db.module.js';
import {
  activities,
  activityAttachments,
  activityParticipants,
  auditEvents,
  campaignMessages,
  campaigns,
  inboundMessages,
  contacts,
  customers,
  files,
  fileVersions,
  folders,
  users,
} from '../db/schema/index.js';
import { customerHistory } from '../customers/customers.service.js';
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
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));
  if (!row) throw new ActivityError('CUSTOMER_NOT_FOUND');
  return row;
}

/** The contacts must be the customer's own, the colleagues must exist. */
async function checkParticipants(tx: Tx, customerId: string, input: ActivityValues) {
  const contactIds = [...new Set(input.contactIds)];
  const userIds = [...new Set(input.userIds)];
  if (contactIds.length > 0) {
    const found = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, contactIds),
          eq(contacts.customerId, customerId),
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
    const people = await checkParticipants(tx, customerId, input);
    const versionIds = await resolveAttachments(tx, input);
    const [created] = await tx
      .insert(activities)
      .values({ ...columnsOf(input), customerId, authorUserId: userId })
      .returning({ id: activities.id });
    await writeLinks(tx, created!.id, people, versionIds);
    return {
      id: created!.id,
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
    await liveCustomer(tx, current.customerId);
    const people = await checkParticipants(tx, current.customerId, input);
    const keptRows = await tx
      .select({ id: activityAttachments.fileVersionId })
      .from(activityAttachments)
      .where(eq(activityAttachments.activityId, id));
    const versionIds = await resolveAttachments(tx, input, new Set(keptRows.map((row) => row.id)));
    const values = columnsOf(input);
    const fields = changedFields(current, values);
    // A next step taken away is no longer done either.
    const done = values.nextStepText ? {} : { nextStepDoneAt: null, nextStepDoneByUserId: null };
    await tx
      .update(activities)
      .set({ ...values, ...done, updatedAt: new Date() })
      .where(eq(activities.id, id));
    await writeLinks(tx, id, people, versionIds);
    return {
      customerId: current.customerId,
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
    .returning({ customerId: activities.customerId });
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
    .returning({ customerId: activities.customerId });
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
      customerId: activities.customerId,
      customerName: customers.name,
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
    .innerJoin(customers, eq(customers.id, activities.customerId))
    .leftJoin(author, eq(author.id, activities.authorUserId))
    .leftJoin(assignee, eq(assignee.id, activities.nextStepUserId))
    .leftJoin(doneBy, eq(doneBy.id, activities.nextStepDoneByUserId))
    .where(and(eq(activities.id, id), alive, isNull(customers.deletedAt)));
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
export async function timeline(db: Db, customerId: string, filter: TimelineFilter) {
  await liveCustomer(db, customerId);
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
        })
        .from(activities)
        .leftJoin(author, eq(author.id, activities.authorUserId))
        .where(and(eq(activities.customerId, customerId), alive, ...kindFilter))
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
              sender: users.name,
            })
            .from(campaignMessages)
            .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
            .innerJoin(users, eq(users.id, campaigns.senderUserId))
            .where(
              and(
                eq(campaignMessages.customerId, customerId),
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
            })
            .from(inboundMessages)
            .where(
              and(
                eq(inboundMessages.customerId, customerId),
                eq(inboundMessages.status, 'assigned'),
              ),
            )
            .orderBy(desc(inboundMessages.receivedAt))
            .limit(TIMELINE_LIMIT)
        ).map((reply) => ({ type: 'reply' as const, at: reply.at, reply }))
      : []),
    ...(filter === 'all' || filter === 'changes'
      ? (await customerHistory(db, customerId))
          // A download of the CSV is not news about the customer.
          .filter((event) => event.diff?.exported !== true)
          .map((event) => ({ type: 'change' as const, at: event.at, change: event }))
      : []),
  ];
  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, TIMELINE_LIMIT);
}

/** „Moje ďalšie kroky“: the open next steps of one person, the ones due first. */
export async function myNextSteps(db: Db, userId: string) {
  return db
    .select({
      id: activities.id,
      text: sql<string>`${activities.nextStepText}`,
      due: activities.nextStepDue,
      kind: activities.kind,
      occurredAt: activities.occurredAt,
      customerId: customers.id,
      customerName: customers.name,
    })
    .from(activities)
    .innerJoin(customers, eq(customers.id, activities.customerId))
    .where(
      and(
        eq(activities.nextStepUserId, userId),
        isNotNull(activities.nextStepText),
        isNull(activities.nextStepDoneAt),
        alive,
        isNull(customers.deletedAt),
      ),
    )
    .orderBy(sql`${activities.nextStepDue} asc nulls last`, asc(activities.occurredAt))
    .limit(50);
}

/** The colleagues and the customer's contacts, for the participants and the assignee. */
export async function activityOptions(db: Db, customerId: string) {
  await liveCustomer(db, customerId);
  const [people, colleagues] = await Promise.all([
    db
      .select({
        id: contacts.id,
        titleBefore: contacts.titleBefore,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        titleAfter: contacts.titleAfter,
        position: contacts.position,
      })
      .from(contacts)
      .where(and(eq(contacts.customerId, customerId), isNull(contacts.deletedAt)))
      .orderBy(desc(contacts.isPrimary), asc(contacts.lastName)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.status, 'active'))
      .orderBy(asc(users.name)),
  ]);
  return {
    contacts: people.map((c) => ({ id: c.id, name: personName(c), position: c.position })),
    users: colleagues,
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
    scope === 'customer' ? eq(folders.customerId, customerId!) : isNull(folders.customerId),
  ];
  if (search) {
    where.push(sql`${files.name} ilike ${`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  }
  const [root] =
    scope === 'customer'
      ? await db
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.customerId, customerId!), isNull(folders.parentId)))
      : [{ id: COMPANY_ROOT_FOLDER_ID }];
  const rows = await db
    .select({
      id: files.id,
      name: files.name,
      folderName: sql<string>`coalesce(${folders.name}, ${customers.name})`,
      size: fileVersions.size,
      version: sql<number>`${fileVersions.number}`,
      changedAt: fileVersions.createdAt,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .innerJoin(folders, eq(folders.id, files.folderId))
    .leftJoin(customers, eq(customers.id, folders.customerId))
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

/** „Kde je použitý“: the activities that keep a version of the file. */
export async function fileUsage(db: Db, fileId: string) {
  return db
    .select({
      activityId: activities.id,
      kind: activities.kind,
      subject: activities.subject,
      occurredAt: activities.occurredAt,
      customerId: customers.id,
      customerName: customers.name,
      version: sql<number>`${fileVersions.number}`,
    })
    .from(activityAttachments)
    .innerJoin(fileVersions, eq(fileVersions.id, activityAttachments.fileVersionId))
    .innerJoin(activities, eq(activities.id, activityAttachments.activityId))
    .innerJoin(customers, eq(customers.id, activities.customerId))
    .where(and(eq(fileVersions.fileId, fileId), alive, isNull(customers.deletedAt)))
    .orderBy(desc(activities.occurredAt))
    .limit(50);
}
