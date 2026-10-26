/** What a sensitive value is replaced with in a log line. */
export const REDACTED = '[redacted]';

/**
 * Keys whose values never leave the server in a log line: names, contacts, addresses,
 * credentials and every free-text field. The API's pino config redacts them
 * (`apps/api/src/logging/logger-options.ts`).
 *
 * This is the safety net, not the rule: a log line is built from ids, codes and counts on purpose,
 * and a key missing here is still a bug where it is logged. A new free-text or personal field in
 * `packages/shared/src/schemas` or `apps/api/src/db/schema` is added here in the same change.
 */
const PERSON = [
  'name',
  'firstName',
  'lastName',
  'fullName',
  'displayName',
  'invitedByName',
  'email',
  'phone',
  'position',
  'address',
  'street',
  'city',
  'postalCode',
  'ip',
  'remoteAddress',
  'userAgent',
] as const;

const SECRET = [
  'password',
  'currentPassword',
  'newPassword',
  'repeatPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'challenge',
  'code',
  'secret',
  'otpauthUri',
  'recoveryCodes',
  'authorization',
  'cookie',
  'set-cookie',
] as const;

/** Free text typed by a person: it may say anything, so it is never logged. */
const FREE_TEXT = ['note', 'notes', 'emailSignature', 'text', 'search', 'query'] as const;

/** What a request or a failed query carries: the input as sent, the SQL parameters. */
const PAYLOAD = ['body', 'input', 'rawInput', 'params'] as const;

const camel = [...PERSON, ...SECRET, ...FREE_TEXT, ...PAYLOAD];
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Each key in camelCase and, for a raw database row, in snake_case (`first_name`). */
export const SENSITIVE_KEYS: readonly string[] = [...new Set(camel.flatMap((k) => [k, snake(k)]))];

const sensitive = new Set(SENSITIVE_KEYS.map((k) => k.toLowerCase()));

/** Case-insensitive: `FirstName` and `firstname` are the same field to a reader. */
export const isSensitiveKey = (key: string) => sensitive.has(key.toLowerCase());
