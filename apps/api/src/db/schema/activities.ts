import { ACTIVITY_KINDS, type RichText } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { contacts, organizations } from './customers.js';
import { fileVersions } from './files.js';
import { users } from './users.js';

export const activityKind = pgEnum('activity_kind', ACTIVITY_KINDS);

/**
 * A contact with a customer outside the app: a call, a meeting, a video call, or a note. Anyone may
 * edit one (D-24); each edit is audited. `bodyText` is the plain text of `body`, for the timeline's
 * preview. The optional next step (D-23) is done once `nextStepDoneAt` is set. Soft deleted.
 */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: activityKind('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    durationMin: integer('duration_min'),
    subject: text('subject'),
    body: jsonb('body').$type<RichText>(),
    bodyText: text('body_text'),
    nextStepText: text('next_step_text'),
    nextStepDue: date('next_step_due'),
    nextStepUserId: uuid('next_step_user_id').references(() => users.id),
    nextStepDoneAt: timestamp('next_step_done_at', { withTimezone: true }),
    nextStepDoneByUserId: uuid('next_step_done_by_user_id').references(() => users.id),
    /** The due date the assignee was last reminded of; a new date reminds again. */
    nextStepRemindedFor: date('next_step_reminded_for'),
    authorUserId: uuid('author_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('activities_organization_idx').on(t.organizationId, t.occurredAt),
    // „Moje ďalšie kroky“: the open next steps of one person.
    index('activities_next_step_idx')
      .on(t.nextStepUserId, t.nextStepDue)
      .where(
        sql`${t.nextStepText} is not null and ${t.nextStepDoneAt} is null and ${t.deletedAt} is null`,
      ),
    check(
      'activities_duration_positive',
      sql`${t.durationMin} is null or ${t.durationMin} between 1 and 1440`,
    ),
  ],
);

/** Who took part: contacts of the customer and colleagues. Exactly one of the two per row. */
export const activityParticipants = pgTable(
  'activity_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id),
    userId: uuid('user_id').references(() => users.id),
  },
  (t) => [
    index('activity_participants_activity_idx').on(t.activityId),
    uniqueIndex('activity_participants_contact_unique')
      .on(t.activityId, t.contactId)
      .where(sql`${t.contactId} is not null`),
    uniqueIndex('activity_participants_user_unique')
      .on(t.activityId, t.userId)
      .where(sql`${t.userId} is not null`),
    check('activity_participants_one', sql`(${t.contactId} is null) <> (${t.userId} is null)`),
  ],
);

/**
 * A file the activity points to, by the VERSION it had then: a later edit of the file never
 * changes what the activity shows. A version referenced here is never purged with the trash.
 */
export const activityAttachments = pgTable(
  'activity_attachments',
  {
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    fileVersionId: uuid('file_version_id')
      .notNull()
      .references(() => fileVersions.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.activityId, t.fileVersionId] }),
    index('activity_attachments_version_idx').on(t.fileVersionId),
  ],
);
