/**
 * What a typed text means in `DatePicker`, `TimePicker` and `NumberField`. The fields keep the
 * text the user types and hand the form only values in the form's own shape: `YYYY-MM-DD`,
 * `HH:mm` on the 5-minute grid, a number.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-12-31` → `31. 12. 2026` (how dates are written everywhere in the app); `''` → `''`. */
export function formatDateText(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${Number(match[3])}. ${Number(match[2])}. ${match[1]}` : '';
}

/**
 * A typed date → `YYYY-MM-DD`, or `null` while it is not a whole, real date. Takes `31.12.2026`,
 * `31. 12. 2026`, `1.2.2026` and `2026-12-31` (pasted from elsewhere); the year has four digits.
 */
export function parseDateText(text: string): string | null {
  const s = text.trim();
  let parts: [string, string, string] | null = null;
  const dotted = /^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (dotted) parts = [dotted[3]!, dotted[2]!, dotted[1]!];
  else if (iso) parts = [iso[1]!, iso[2]!, iso[3]!];
  if (!parts) return null;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? `${parts[0]}-${pad(month)}-${pad(day)}` : null;
}

/**
 * A day picked in the calendar → `YYYY-MM-DD` from its local date parts. `toISOString()` would be
 * a day early in Slovakia: the calendar's days are local midnights, which are the previous day in UTC.
 */
export const isoOfDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * `Select`'s "none" choice: the app uses `''` for it, which Radix refuses as an item value, so it
 * travels as this token between the component and Radix.
 */
export const SELECT_NONE = '__none__';
export const toSelectItem = (value: string) => (value === '' ? SELECT_NONE : value);
export const fromSelectItem = (value: string) => (value === SELECT_NONE ? '' : value);

/** Visit times are planned on a 5-minute grid. */
export const MINUTE_STEP = 5;

/** Minutes since midnight → `HH:mm`, rounded to the nearest step and kept within the day. */
export function snapTime(totalMinutes: number, step = MINUTE_STEP): string {
  const snapped = Math.min(Math.round(totalMinutes / step) * step, 24 * 60 - step);
  return `${pad(Math.floor(snapped / 60))}:${pad(snapped % 60)}`;
}

/**
 * A typed time → `HH:mm` on the 5-minute grid, or `null` while it is not a time. `7:42` → `07:40`,
 * `7.43` → `07:45`, `740` → `07:40`, `19` → `19:00`, `23:58` → `23:55`.
 */
export function parseTimeText(text: string, step = MINUTE_STEP): string | null {
  const s = text.trim();
  let hours: number;
  let minutes: number;
  const separated = /^(\d{1,2})(?:\s*[:.\s]\s*(\d{1,2}))?$/.exec(s);
  const compact = /^\d{3,4}$/.exec(s);
  if (separated) {
    hours = Number(separated[1]);
    minutes = separated[2] === undefined ? 0 : Number(separated[2]);
  } else if (compact) {
    hours = Number(s.slice(0, -2));
    minutes = Number(s.slice(-2));
  } else return null;
  if (hours > 23 || minutes > 59) return null;
  return snapTime(hours * 60 + minutes, step);
}

/** Decimal places of a step: `0.05` → 2, `1` → 0. */
const decimalsOf = (step: number) => (String(step).split('.')[1] ?? '').length;

/** A typed number, with a comma or a dot as the decimal mark → number; `null` when empty or not one. */
export function parseNumberText(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}

/** `0.5` → `0,5`, the Slovak decimal mark; `null` → `''`. */
export const formatNumberText = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value).replace('.', ',');

/** Whether a text is on its way to a number the field accepts (typed characters are filtered by it). */
export function isNumberDraft(
  text: string,
  { step = 1, min }: { step?: number | undefined; min?: number | undefined },
) {
  const sign = min === undefined || min < 0 ? '-?' : '';
  const fraction = decimalsOf(step) > 0 ? '([.,]\\d*)?' : '';
  return new RegExp(`^${sign}\\d*${fraction}$`).test(text);
}

type Range = { min?: number | undefined; max?: number | undefined };

export function clampNumber(value: number, { min, max }: Range) {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

/**
 * One step up (`1`) or down (`-1`) from `value`, within `min`–`max` and without float noise
 * (`0.1 + 0.05` is `0.15`, not `0.15000000000000002`). From an empty field it starts at `min`.
 */
export function stepNumber(
  value: number | null | undefined,
  direction: 1 | -1,
  { step = 1, min, max }: Range & { step?: number | undefined },
): number {
  if (value === null || value === undefined) return clampNumber(min ?? 0, { min, max });
  const next = Number((value + direction * step).toFixed(decimalsOf(step)));
  return clampNumber(next, { min, max });
}
