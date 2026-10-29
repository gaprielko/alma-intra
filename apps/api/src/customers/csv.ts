import { sk } from '@intra/shared/i18n';
import type { exportRows } from './customers.service.js';

type Row = Awaited<ReturnType<typeof exportRows>>[number];

const c = sk.customers.csv;

/**
 * One field of a CSV line, quoted when it has to be. A value starting with `=`, `+`, `-`, `@`, a
 * tab or a carriage return is prefixed with `'`, so a spreadsheet shows it instead of running it.
 * A phone number (`+421 905 …`) is no formula and stays as it is.
 */
export function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const formula = /^[=+\-@\t\r]/.test(value) && !/^\+[\d ]+$/.test(value);
  const safe = formula ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** „27. 10. 2026“ in Bratislava, whatever the server's own time zone. */
const dayFormat = new Intl.DateTimeFormat('sk-SK', {
  timeZone: 'Europe/Bratislava',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});
const day = (date: Date) => dayFormat.format(date);

/** Excel reads a CSV as UTF-8 only when it starts with the byte order mark. */
const BOM = String.fromCharCode(0xfeff);

/**
 * The organizations as CSV for Excel in Slovak: semicolons, a BOM so the accents survive, CRLF lines.
 * Headers and values in the words of the app, never the codes.
 */
export function toCsv(rows: Row[]): string {
  const header = [
    c.name,
    c.kind,
    c.contactType,
    c.products,
    c.status,
    c.ico,
    c.dic,
    c.icDph,
    c.street,
    c.postalCode,
    c.city,
    c.region,
    c.email,
    c.phone,
    c.web,
    c.owner,
    c.source,
    c.tags,
    c.contact,
    c.contactEmail,
    c.contactPhone,
    c.salutation,
    c.createdAt,
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      sk.customers.kind[r.kind],
      r.contactType,
      r.products.map((p) => p.name).join(', '),
      r.status ? sk.customers.status[r.status] : null,
      r.ico,
      r.dic,
      r.icDph,
      r.street,
      r.postalCode,
      r.city,
      r.region ? sk.customers.region[r.region] : null,
      r.email,
      r.phone,
      r.web,
      r.owner,
      r.source,
      r.tags.map((t) => t.name).join(', '),
      r.primary?.name,
      r.primary?.email,
      r.primary?.phone,
      r.primary?.salutation,
      day(new Date(r.createdAt)),
    ]
      .map(csvField)
      .join(';'),
  );
  return `${BOM}${[header.map(csvField).join(';'), ...lines].join('\r\n')}\r\n`;
}
