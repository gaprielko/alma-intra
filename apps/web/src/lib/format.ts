import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { sk } from '@intra/shared/i18n';

const asDate = (value: string | Date) => (typeof value === 'string' ? parseISO(value) : value);

/** `27.10.2026` */
export const formatDate = (value: string | Date) => format(asDate(value), 'd.M.yyyy');

/** `27.10.2026 9:40` */
export const formatDateTime = (value: string | Date) => format(asDate(value), 'd.M.yyyy H:mm');

/** „Dnes 9:12“, „Včera 16:40“, or the date for anything older. */
export function formatRecent(value: string | Date): string {
  const date = asDate(value);
  if (isToday(date)) return `${sk.common.today} ${format(date, 'H:mm')}`;
  if (isYesterday(date)) return `${sk.common.yesterday} ${format(date, 'H:mm')}`;
  return formatDate(date);
}

/** `Jana Horváthová` → `JH`: the first letters of the first and the last word. */
export const nameInitials = (fullName: string) => {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
};
