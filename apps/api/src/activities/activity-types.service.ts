import { ACTIVITY_TYPE_FEEDBACK_ID, SYSTEM_ACTIVITY_TYPE_IDS } from '@intra/shared/schemas';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { activityTypes, campaigns, emailTemplates, leadActivities } from '../db/schema/index.js';

/** A refusal the web words for itself (`sk.activityTypes.errors`). */
export class ActivityTypeError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NAME_TAKEN' | 'IN_USE' | 'SYSTEM_ITEM') {
    super(code);
  }
}

const isNameClash = (error: unknown) => {
  const constraint =
    (error as { constraint?: string } | null)?.constraint ??
    (error as { cause?: { constraint?: string } } | null)?.cause?.constraint;
  return constraint === 'activity_types_name_unique';
};

async function mapNameClash<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isNameClash(error)) throw new ActivityTypeError('NAME_TAKEN');
    throw error;
  }
}

/** A button keeps a type's id in its document: a template's or an e-mail's. */
const inDocument = (column: typeof emailTemplates.body | typeof campaigns.body, id: string) =>
  sql`${column}::text like ${`%"activityTypeId": "${id}"%`}`;

/** The types in their order, with their entries and whether a button still holds them. */
export async function listActivityTypes(db: Db) {
  const rows = await db
    .select({
      id: activityTypes.id,
      name: activityTypes.name,
      confirmLabel: activityTypes.confirmLabel,
      asksProduct: activityTypes.asksProduct,
      active: activityTypes.active,
      entries: sql<number>`(select count(*)::int from lead_activities la
        where la.type_id = "activity_types"."id" and la.deleted_at is null)`,
      inButtons: sql<boolean>`exists (select 1 from email_templates t
          where t.body::text like '%"activityTypeId": "' || "activity_types"."id" || '"%')
        or exists (select 1 from campaigns c
          where c.body::text like '%"activityTypeId": "' || "activity_types"."id" || '"%')`,
    })
    .from(activityTypes)
    .orderBy(asc(activityTypes.position), sql`${activityTypes.name} collate "sk-x-icu"`);
  return rows.map((row) => ({ ...row, system: SYSTEM_ACTIVITY_TYPE_IDS.includes(row.id) }));
}

/** A new type, last in the order. */
export async function createActivityType(
  db: Db,
  values: { name: string; confirmLabel: string; asksProduct: boolean; active: boolean },
) {
  return mapNameClash(async () => {
    const [created] = await db
      .insert(activityTypes)
      .values({
        ...values,
        position: sql`(select coalesce(max(${activityTypes.position}), 0) + 1 from ${activityTypes})`,
      })
      .returning({ id: activityTypes.id });
    return created!;
  });
}

/** A podnet has no button, so it keeps its empty label and asks for no product. */
export async function updateActivityType(
  db: Db,
  id: string,
  values: { name: string; confirmLabel: string | null; asksProduct: boolean; active: boolean },
) {
  return mapNameClash(async () => {
    const [before] = await db.select().from(activityTypes).where(eq(activityTypes.id, id));
    if (!before) throw new ActivityTypeError('NOT_FOUND');
    const next =
      id === ACTIVITY_TYPE_FEEDBACK_ID
        ? { ...values, confirmLabel: null, asksProduct: false }
        : { ...values, confirmLabel: values.confirmLabel ?? before.confirmLabel };
    await db
      .update(activityTypes)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(activityTypes.id, id));
    const fields = (['name', 'confirmLabel', 'asksProduct', 'active'] as const).filter(
      (field) => before[field] !== next[field],
    );
    return { fields };
  });
}

/**
 * Only a type used nowhere goes: no entry and no button in a template or an e-mail. An entry already
 * removed from Aktivity does not keep it, as with a product.
 */
export async function deleteActivityType(db: Db, id: string) {
  if (SYSTEM_ACTIVITY_TYPE_IDS.includes(id)) throw new ActivityTypeError('SYSTEM_ITEM');
  await db.transaction(async (tx) => {
    const [live] = await tx
      .select({ id: leadActivities.id })
      .from(leadActivities)
      .where(and(eq(leadActivities.typeId, id), sql`${leadActivities.deletedAt} is null`))
      .limit(1);
    const [template] = await tx
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(inDocument(emailTemplates.body, id))
      .limit(1);
    const [campaign] = await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(isNotNull(campaigns.body), inDocument(campaigns.body, id)))
      .limit(1);
    if (live || template || campaign) throw new ActivityTypeError('IN_USE');
    await tx.delete(leadActivities).where(eq(leadActivities.typeId, id));
    const [row] = await tx
      .delete(activityTypes)
      .where(eq(activityTypes.id, id))
      .returning({ id: activityTypes.id });
    if (!row) throw new ActivityTypeError('NOT_FOUND');
  });
}
