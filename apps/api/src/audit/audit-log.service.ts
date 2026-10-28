import { type AuditListInput, auditListSchema, PAGE_SIZE } from '@intra/shared/schemas';
import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { auditEvents, users } from '../db/schema/index.js';

/**
 * The name of what an event is about, read now from its own table (the trail keeps ids only):
 * a contact, a file, an e-mail, a received e-mail, a template, a colleague. Gone since: none.
 */
const subjectName = sql<string | null>`case ${auditEvents.entityType}
  when 'customer' then (select c.name from customers c where c.id::text = ${auditEvents.entityId})
  when 'file' then (select f.name from files f where f.id::text = ${auditEvents.entityId})
  when 'campaign' then (select c.subject_text from campaigns c where c.id::text = ${auditEvents.entityId})
  when 'inbound' then (select i.subject from inbound_messages i where i.id::text = ${auditEvents.entityId})
  when 'template' then (select t.name from email_templates t where t.id::text = ${auditEvents.entityId})
  when 'user' then (select u.name from users u where u.id::text = ${auditEvents.entityId})
  when 'folder' then (select f.name from folders f where f.id::text = ${auditEvents.entityId})
  else null end`;

/**
 * Nastavenia › Záznam aktivít (D-16): the audit trail newest first, one page, with who acted
 * (and whether it was Claude for them) and the name of what it touched.
 */
export async function listAuditEvents(db: Db, raw: AuditListInput) {
  const input = auditListSchema.parse(raw);
  const where: SQL[] = [];
  if (input.userId) where.push(eq(auditEvents.userId, input.userId));
  if (input.area) where.push(eq(auditEvents.entityType, input.area));
  if (input.claudeOnly) where.push(eq(auditEvents.actorKind, 'claude'));
  const rows = await db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      action: auditEvents.action,
      kind: auditEvents.kind,
      actorKind: auditEvents.actorKind,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      userName: users.name,
      subject: subjectName,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.userId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditEvents.at))
    .limit(PAGE_SIZE)
    .offset((input.page - 1) * PAGE_SIZE);
  return { items: rows, total: rows[0]?.total ?? 0, page: input.page, pageSize: PAGE_SIZE };
}
