import { z } from 'zod';

export const idSchema = z.string().uuid();

/** A malformed address says so under the field (`invalid_email`), not „Neplatná hodnota“. */
export const emailSchema = z.string().trim().toLowerCase().email('invalid_email');

/** Slovak numbers in the one shape the app keeps: `+421 912 345 678`. */
const SLOVAK_PHONE = /^\+421 \d{3} \d{3} \d{3}$/;
/** A foreign number: `+` and its country code, then groups of digits; 8 to 15 digits in all. */
const FOREIGN_PHONE = /^\+(?!421)\d{1,3}(?: \d{1,4})+$/;

const groupsOf3 = (digits: string) => digits.match(/\d{1,3}/g) ?? [];

/**
 * A phone number in the app's shape, from however it was typed: `0912345678`, `00421 912345678`
 * and `+421912345678` all become `+421 912 345 678`. A foreign number keeps the person's own
 * grouping after its `+`. Partial input is grouped as far as it goes, so the field can format
 * while somebody types.
 */
export function formatPhone(raw: string): string {
  const typed = raw.trim();
  if (!typed) return typed;
  const international = typed.startsWith('+') || typed.startsWith('00');
  let digits = typed.replace(/\D/g, '');
  if (typed.startsWith('00')) digits = digits.slice(2);
  if (!international) {
    // A Slovak number written the domestic way: the leading 0 becomes +421.
    if (!digits.startsWith('0')) return typed;
    digits = `421${digits.slice(1)}`;
  }
  if (digits.startsWith('421')) return ['+421', ...groupsOf3(digits.slice(3))].join(' ');
  if ('421'.startsWith(digits)) return `+${digits}`;
  return `+${typed
    .replace(/^(\+|00)/, '')
    .replace(/[^\d ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()}`;
}

/**
 * A phone number, stored as `+421 912 345 678` (a foreign one as `+<code> <digits>`). Whatever
 * the person typed is formatted first; what still does not fit is refused (`invalid_phone`).
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform(formatPhone)
  .pipe(
    z
      .string()
      .refine(
        (value) =>
          SLOVAK_PHONE.test(value) ||
          (FOREIGN_PHONE.test(value) &&
            value.replace(/\D/g, '').length >= 8 &&
            value.replace(/\D/g, '').length <= 15),
        'invalid_phone',
      ),
  );

/** Rows per page of every paged list, on the web and as the API's default. */
export const PAGE_SIZE = 20;

/** The areas of the activity log's filter (D-16), as the audit trail names them. */
export const AUDIT_AREAS = [
  'customer',
  'person',
  'activity',
  'file',
  'folder',
  'campaign',
  'inbound',
  'template',
  'user',
  'mcp',
] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

/** Nastavenia › Záznam aktivít: a page of the audit trail, newest first. */
export const auditListSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  userId: idSchema.optional(),
  area: z.enum(AUDIT_AREAS).optional(),
  /** Only what Claude did through MCP. */
  claudeOnly: z.boolean().default(false),
});
export type AuditListInput = z.input<typeof auditListSchema>;
