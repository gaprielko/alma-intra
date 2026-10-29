import { customerFilterSchema } from '@intra/shared/schemas';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { segments, users } from '../db/schema/index.js';
import { customerIdsMatching } from './customers.service.js';

/** At most this many recipients come from one segment, the size of one e-mail's list. */
export const SEGMENT_RECIPIENTS = 500;

/** A segment one may use: one's own, or shared by a colleague. */
const visibleTo = (userId: string) =>
  or(eq(segments.ownerUserId, userId), eq(segments.shared, true));

/** My segments and the shared ones, by name. */
export async function listSegments(db: Db, userId: string) {
  const rows = await db
    .select({
      id: segments.id,
      name: segments.name,
      filters: segments.filters,
      shared: segments.shared,
      ownerName: users.name,
      mine: sql<boolean>`${segments.ownerUserId} = ${userId}`,
    })
    .from(segments)
    .innerJoin(users, eq(users.id, segments.ownerUserId))
    .where(visibleTo(userId))
    .orderBy(asc(sql`${segments.name} collate "sk-x-icu"`));
  // Stored filters are read through the schema: a filter dropped since is simply ignored.
  return rows.map((row) => ({ ...row, filters: customerFilterSchema.parse(row.filters) }));
}

export async function createSegment(
  db: Db,
  userId: string,
  input: { name: string; filters: unknown; shared: boolean },
) {
  const [row] = await db
    .insert(segments)
    .values({
      name: input.name,
      filters: customerFilterSchema.parse(input.filters),
      shared: input.shared,
      ownerUserId: userId,
    })
    .returning({ id: segments.id });
  return { id: row!.id };
}

/** Only its author renames it or shares it; false when it is not theirs. */
export async function updateSegment(
  db: Db,
  userId: string,
  input: { id: string; name: string; shared: boolean },
) {
  const rows = await db
    .update(segments)
    .set({ name: input.name, shared: input.shared, updatedAt: new Date() })
    .where(and(eq(segments.id, input.id), eq(segments.ownerUserId, userId)))
    .returning({ id: segments.id });
  return rows.length > 0;
}

export async function deleteSegment(db: Db, userId: string, id: string) {
  const rows = await db
    .delete(segments)
    .where(and(eq(segments.id, id), eq(segments.ownerUserId, userId)))
    .returning({ id: segments.id });
  return rows.length > 0;
}

/** The organizations a segment finds today, for an e-mail's recipients; null when not visible. */
export async function segmentCustomerIds(db: Db, userId: string, id: string) {
  const [row] = await db
    .select({ filters: segments.filters })
    .from(segments)
    .where(and(eq(segments.id, id), visibleTo(userId)));
  if (!row) return null;
  return customerIdsMatching(db, customerFilterSchema.parse(row.filters), SEGMENT_RECIPIENTS);
}
