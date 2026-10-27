import {
  ACTIVITY_KINDS,
  CODE_LISTS,
  CUSTOMER_KINDS,
  CUSTOMER_STATUSES,
  FILE_GROUPS,
  SECOND_STEPS,
  USER_STATUSES,
} from '@intra/shared/schemas';

/**
 * What an audit event may contain. `audit_events` is append-only: a value written there
 * stays for good, so a value is stored only for a key named here, per entity type, and only when
 * it is of the kind declared for that key. Everything else a procedure passes to
 * `ctx.audit.set({ diff })` is replaced by `[omitted]` — the key stays, so the trail still says
 * the field was part of the change.
 *
 * A diff is flat: `{ key: value }` or `{ key: { before, after } }`, scalars only (plus arrays of
 * declared names). Anything nested deeper is omitted as a whole.
 *
 * Allowed: business data of an organization, enum values, ids, counts, reason CODES.
 * Never: names of persons, e-mails, phone numbers, addresses of persons, birth numbers, diagnoses,
 * free text. When in doubt leave the key out; adding one is a reviewed change to this file.
 */
type Rule = (value: unknown) => boolean;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT = 300;

/** A short line of business data (an organization's name, its IČO, a date). Never an object. */
const text: Rule = (v) => typeof v === 'string' && v.length <= MAX_TEXT;
const number: Rule = (v) => typeof v === 'number' && Number.isFinite(v);
const flag: Rule = (v) => typeof v === 'boolean';
const uuid: Rule = (v) => typeof v === 'string' && UUID.test(v);
const oneOf =
  (values: readonly (string | number)[]): Rule =>
  (v) =>
    (typeof v === 'string' || typeof v === 'number') && values.includes(v);
/** An array of members of a fixed set: which filters a list was called with, which weekdays. */
const subsetOf =
  (values: readonly (string | number)[]): Rule =>
  (v) =>
    Array.isArray(v) && v.length <= values.length && v.every((item) => oneOf(values)(item));

/** Names of the filters of a list read; the values of the filters are never stored. */
export const LIST_FILTERS = ['search', 'status'] as const;

/**
 * `reasonCode` is always one of a fixed set of codes; text a person typed never goes under it.
 * `locked`: this failure reached the per-e-mail limit and locked the login. `wrong_code`: a wrong
 * code at the second step or at a setup. `deactivated`: a deactivated user tried to sign in.
 */
const AUTH_REASON_CODES = [
  'invalid',
  'deactivated',
  'rate_limited',
  'wrong_password',
  'locked',
  'wrong_code',
];

/** Why a change to a user was refused: nobody deactivates themselves or the last active user. */
const USER_REASON_CODES = [...AUTH_REASON_CODES, 'self', 'last_active_user', 'already_exists'];

/** The fields of a user's profile that may be named in an event, never their values. */
const PROFILE_FIELDS = ['name', 'phone', 'position', 'emailSignature'];

/** The fields of a customer or a contact that may be named in an event, never their values. */
const CUSTOMER_FIELDS = [
  'name',
  'titleBefore',
  'firstName',
  'lastName',
  'titleAfter',
  'gender',
  'salutation',
  'position',
  'ico',
  'dic',
  'icDph',
  'web',
  'email',
  'phone',
  'typeId',
  'street',
  'postalCode',
  'city',
  'region',
  'sourceId',
  'tags',
  'note',
  'almaOrganizationId',
  'receivesBulk',
];

/** Up to a page of customers a bulk action named; ids only. */
const uuidList: Rule = (v) => Array.isArray(v) && v.length <= 100 && v.every((id) => uuid(id));

const AUDIT_ALLOW_LIST: Record<string, Record<string, Rule>> = {
  /**
   * Auth events about nobody in particular (a failed login for an unknown e-mail), and for how
   * many minutes such a failure locked the e-mail typed, never the e-mail itself.
   */
  auth: { reasonCode: oneOf(AUTH_REASON_CODES), lockMinutes: number },
  /**
   * A user's own account and the management of users: which fields changed, status changes,
   * how the second step went. Never a name, an e-mail, a phone, a password, a code or a secret.
   */
  user: {
    reasonCode: oneOf(USER_REASON_CODES),
    lockMinutes: number,
    loginUnlocked: flag,
    fields: subsetOf(PROFILE_FIELDS),
    otherSessionsEnded: flag,
    status: oneOf(USER_STATUSES),
    invitationResent: flag,
    secondStep: oneOf(SECOND_STEPS),
    method: oneOf(['totp', 'recovery_code']),
    rememberDevice: flag,
    recoveryCodesLeft: number,
    replaced: flag,
    secondFactorReset: flag,
    sessionId: uuid,
    filters: subsetOf(LIST_FILTERS),
    resultCount: number,
  },
  /**
   * A customer and its contacts: which fields changed (names), the status, the owner and the type
   * by id, what happened to a contact. Never a name, an e-mail, a phone, an address or a note.
   */
  customer: {
    kind: oneOf(CUSTOMER_KINDS),
    status: oneOf(CUSTOMER_STATUSES),
    ownerUserId: uuid,
    firstContact: flag,
    fields: subsetOf(CUSTOMER_FIELDS),
    deleted: flag,
    contact: oneOf(['created', 'updated', 'primary', 'deleted']),
    contactId: uuid,
    ids: uuidList,
    count: number,
    tagAdded: flag,
    exported: flag,
    selected: flag,
    resultCount: number,
    filters: subsetOf(['search', 'status', 'kind', 'typeId', 'region', 'tagId', 'ownerUserId']),
  },
  /** Settings › Číselníky: which list, which fields, switched on or off. Names are not kept. */
  code_list: {
    list: oneOf([...CODE_LISTS, 'tag']),
    fields: subsetOf(['name', 'active']),
    active: flag,
  },
  /**
   * A file: its folder, the version and its group, what changed. Never a file's or a folder's
   * name, a description or a note: people type those.
   */
  file: {
    folderId: uuid,
    customerId: uuid,
    versionId: uuid,
    version: number,
    restoredFrom: number,
    group: oneOf(FILE_GROUPS),
    size: number,
    fields: subsetOf(['name', 'description', 'folderId']),
    trashed: flag,
    restored: flag,
    inline: flag,
    uploadRefused: oneOf(['UPLOAD_MISSING', 'UPLOAD_MISMATCH']),
  },
  /**
   * An activity: its customer and kind, which fields changed, how many people and files. Never a
   * subject, the notes or a next step's text: people type those.
   */
  activity: {
    customerId: uuid,
    kind: oneOf(ACTIVITY_KINDS),
    fields: subsetOf([
      'kind',
      'occurredAt',
      'durationMin',
      'subject',
      'body',
      'nextStepText',
      'nextStepDue',
      'nextStepUserId',
    ]),
    contacts: number,
    attachments: number,
    nextStep: flag,
    nextStepDone: flag,
    deleted: flag,
  },
  folder: {
    parentId: uuid,
    customerId: uuid,
    fields: subsetOf(['name', 'parentId']),
    deleted: flag,
  },
};

const SECRET_KEY = /pass(word)?|token|secret|hash|authorization|cookie/i;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const REDACTED = '[redacted]';
const OMITTED = '[omitted]';
const MAX_KEYS = 50;
const MAX_DIFF_CHARS = 6000;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

function leaf(value: unknown, rule: Rule): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    // An invalid date has no ISO form (`toISOString` throws a RangeError).
    return Number.isNaN(value.getTime()) || rule !== text ? OMITTED : value.toISOString();
  }
  return rule(value) ? value : OMITTED;
}

function isChange(value: unknown): value is { before?: unknown; after?: unknown } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key === 'before' || key === 'after');
}

function filter(diff: unknown, rules: Record<string, Rule>): unknown {
  if (diff === null || diff === undefined) return null;
  if (!isPlainObject(diff)) return OMITTED;
  const entries = Object.entries(diff)
    .filter(([key]) => FIELD_NAME.test(key))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, MAX_KEYS)
    .map(([key, value]): [string, unknown] => {
      // Secret-looking keys are redacted wherever they appear, allow-listed or not.
      if (SECRET_KEY.test(key)) return [key, REDACTED];
      const rule = Object.hasOwn(rules, key) ? rules[key]! : null;
      if (!rule) return [key, OMITTED];
      if (isChange(value)) {
        return [key, { before: leaf(value.before, rule), after: leaf(value.after, rule) }];
      }
      return [key, leaf(value, rule)];
    });
  const result = Object.fromEntries(entries);
  return JSON.stringify(result).length > MAX_DIFF_CHARS ? OMITTED : result;
}

/**
 * The diff a procedure asked for, reduced to what may be stored for its entity type. Never
 * throws: a value that cannot be serialised (BigInt, a cycle) must not fail the mutation it
 * describes.
 */
export function allowListed(entityType: string, diff: unknown): unknown {
  try {
    const rules = Object.hasOwn(AUDIT_ALLOW_LIST, entityType) ? AUDIT_ALLOW_LIST[entityType]! : {};
    return filter(diff, rules);
  } catch {
    return OMITTED;
  }
}

/**
 * The default diff: the names of the top-level fields that were sent, never their values. The raw
 * input still has the keys Zod would strip, and a key is caller-controlled text too — so only
 * names the procedure's input schema declares (`knownKeys`, see `input-keys.ts`) are kept.
 */
export function fieldsOf(
  input: unknown,
  knownKeys: ReadonlySet<string>,
): { fields: string[] } | null {
  if (!isPlainObject(input)) return null;
  return {
    fields: Object.keys(input)
      .filter((key) => knownKeys.has(key))
      .sort(),
  };
}
