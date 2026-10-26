import { z } from 'zod';

export const idSchema = z.string().uuid();

/** A malformed address says so under the field (`invalid_email`), not „Neplatná hodnota“. */
export const emailSchema = z.string().trim().toLowerCase().email('invalid_email');

/**
 * Phone number as people write it: `+421 905 111 222`, `0905111222`, a landline `+421 52 432 1111`
 * or a foreign number with its country code. A prefix (`+` or `00` and a country code, or `0`),
 * then the number in any grouping of spaces. A Slovak number has exactly nine digits after the
 * prefix; a foreign one is checked against E.164, 8 to 15 digits with the country code.
 */
function phoneDigitsValid(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+') || value.startsWith('00')) {
    const international = value.startsWith('+') ? digits : digits.slice(2);
    if (international.startsWith('421')) return international.length === 3 + 9;
    return international.length >= 8 && international.length <= 15;
  }
  return digits.length === 1 + 9;
}
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+\d{1,3}|0)(?: ?\d)+$/, 'invalid_phone')
  .refine(phoneDigitsValid, 'invalid_phone');

/** Rows per page of every paged list, on the web and as the API's default. */
export const PAGE_SIZE = 20;
