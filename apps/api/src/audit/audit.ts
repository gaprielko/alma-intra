import type { Request } from 'express';
import type { Db, Tx } from '../db/db.module.js';
import { auditEvents } from '../db/schema/index.js';
import { allowListed, fieldsOf } from './allow-list.js';
import { inputKeysOf } from './input-keys.js';

/**
 * Details only the procedure knows. Optional: by default the event gets the entity type from the
 * procedure path, the entity id from `input.id` / `result.id`, and as diff only the NAMES of the
 * fields that were sent. Values reach the trail only through `diff`, and only for the keys the
 * allow-list names for the entity type.
 */
export interface AuditDetails {
  userId?: string;
  entityType?: string;
  entityId?: string;
  diff?: unknown;
  /**
   * Do not record this *refused* call (`meta.auditFailure`): it is part of a flood already
   * recorded. Successful mutations are audited regardless.
   */
  skipFailureAudit?: boolean;
}

/** One per procedure call, never per HTTP request: a batch carries several calls. */
export class AuditTrail {
  details: AuditDetails = {};
  set(details: AuditDetails) {
    this.details = { ...this.details, ...details };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The entity an input or result names: `id`, or for the user procedures `userId`. Ids are UUIDs;
 * anything else in such a field is text somebody typed, and is not stored.
 */
const ID_FIELDS = ['id', 'userId'] as const;
function idOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  for (const field of ID_FIELDS) {
    const id = (value as Record<string, unknown>)[field];
    if (typeof id === 'string') return UUID.test(id) ? id : undefined;
  }
  return undefined;
}

export interface AuditWrite {
  db: Db | Tx;
  req?: Request;
  requestId: string;
  path: string;
  kind: 'mutation' | 'read';
  input: unknown;
  result: unknown;
  trail: AuditTrail;
  sessionUserId: string | null;
  /** The call was refused (`<path>.denied`): the diff is the reason code and nothing else. */
  denied?: { reason: DeniedReason };
}

/**
 * Why access was refused: `role` — the role may not perform the action at all; `second_factor`
 * — the session belongs to a user who has not set up the mandatory second factor yet.
 */
export type DeniedReason = 'role' | 'second_factor';

export async function writeAuditEvent(w: AuditWrite) {
  const d = w.trail.details;
  const entityType = d.entityType ?? w.path.split('.')[0]!;
  // `w.path` of a denied or failed event carries a suffix; the schema is the procedure's.
  const procedurePath = w.path.replace(/\.(denied|failed)$/, '');
  const diff = w.denied
    ? { reasonCode: w.denied.reason }
    : d.diff !== undefined
      ? allowListed(entityType, d.diff)
      : fieldsOf(w.input, inputKeysOf(procedurePath));
  const entityId = w.denied
    ? (idOf(w.input) ?? d.entityId ?? null)
    : (d.entityId ?? idOf(w.input) ?? idOf(w.result) ?? null);
  await w.db.insert(auditEvents).values({
    userId: d.userId ?? w.sessionUserId,
    action: w.path,
    kind: w.kind,
    entityType,
    entityId,
    diff,
    requestId: w.requestId,
    ip: w.req?.ip ?? null,
    userAgent: w.req?.headers['user-agent']?.slice(0, 200) ?? null,
  });
}
