import { createHash } from 'node:crypto';

/**
 * Reading a forwarded e-mail (docs/email-import.md). A forward keeps the original's sender, date and
 * subject only in the text block the mail client adds, in the client's language; everything here
 * works from that text. Untrusted, every field.
 */

export const IMPORT_LINE = 'alma intra: add mail';

/** The original e-mail a forward carries. */
export interface ForwardedEmail {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: Date;
  /** Its own text, without what it quotes of the e-mails before it. */
  text: string;
}

const LABELS: Record<
  string,
  keyof Pick<ForwardedEmail, 'from' | 'to' | 'cc' | 'subject'> | 'date'
> = {
  from: 'from',
  od: 'from',
  von: 'from',
  to: 'to',
  komu: 'to',
  an: 'to',
  cc: 'cc',
  kopia: 'cc',
  kopie: 'cc',
  subject: 'subject',
  predmet: 'subject',
  betreff: 'subject',
  date: 'date',
  sent: 'date',
  datum: 'date',
  odoslane: 'date',
  odeslano: 'date',
  gesendet: 'date',
};

const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const HEADER_LINE = /^[>\s*]*([\p{L}]+)\s*:\s*\*?\s*(.*)$/u;

/** „From: …“ in any of the known languages: the field it fills and its value, else null. */
function headerOf(line: string) {
  const match = HEADER_LINE.exec(line);
  if (!match) return null;
  const field = LABELS[plain(match[1]!)];
  return field ? { field, value: match[2]!.trim() } : null;
}

const MARKER =
  /^[>\s]*-{2,}\s*(forwarded message|preposlana sprava|preposlany e-?mail|povodna sprava|original message|preposlana zprava|puvodni zprava|ursprungliche nachricht|weitergeleitete nachricht)\s*-{2,}\s*$/;

/** Plain text of an HTML e-mail, for a client that sends no text part. */
export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Where the first block of an original's headers starts; -1 without one. */
function blockStart(lines: string[]) {
  for (let i = 0; i < lines.length; i += 1) {
    if (MARKER.test(plain(lines[i]!))) return i + 1;
    // Outlook has no marker: the block itself, from „From:“ on, with a date and a subject after it.
    if (headerOf(lines[i]!)?.field === 'from') {
      const next = lines
        .slice(i + 1, i + 8)
        .map((line) => headerOf(line)?.field)
        .filter(Boolean);
      if (next.includes('date') && next.includes('subject')) return i;
    }
  }
  return -1;
}

const MONTHS: Record<string, number> = {};
[
  ['jan', 'januar', 'january', 'januara', 'januari'],
  ['feb', 'februar', 'february', 'februara'],
  ['mar', 'marec', 'march', 'marca', 'brezna'],
  ['apr', 'april', 'aprila', 'dubna'],
  ['may', 'maj', 'maja', 'kvetna'],
  ['jun', 'june', 'juna', 'cervna'],
  ['jul', 'july', 'jula', 'cervence'],
  ['aug', 'august', 'augusta', 'srpna'],
  ['sep', 'sept', 'september', 'septembra', 'zari'],
  ['oct', 'okt', 'october', 'oktober', 'oktobra', 'rijna'],
  ['nov', 'november', 'novembra', 'listopadu'],
  ['dec', 'december', 'decembra', 'prosince'],
].forEach((names, month) => names.forEach((name) => (MONTHS[name] = month)));

/** A wall clock in Bratislava as an instant: the forward's block says no zone. */
function inBratislava(y: number, m: number, d: number, hour: number, minute: number) {
  const guess = new Date(Date.UTC(y, m, d, hour, minute));
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Bratislava' }));
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (shown.getTime() - asUtc.getTime()));
}

/** The date as the mail clients write it: „št 15. 10. 2026 o 9:12“, „Oct 15, 2026 at 9:12 AM“, … */
export function parseForwardDate(raw: string): Date | null {
  const text = plain(raw).replace(/\s+/g, ' ').trim();
  const time = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?/.exec(
    text.replace(/\d{1,2}\.\s*\d{1,2}\.\s*\d{4}/, ''),
  );
  let hour = time ? Number(time[1]) : 0;
  const minute = time ? Number(time[2]) : 0;
  if (time?.[3] === 'pm' && hour < 12) hour += 12;
  if (time?.[3] === 'am' && hour === 12) hour = 0;

  let parts: [number, number, number] | null = null;
  const numeric = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(text);
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const dayName = /(\d{1,2})\.?\s+([a-z]+)\.?,?\s+(\d{4})/.exec(text);
  const nameDay = /([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (numeric) parts = [Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1])];
  else if (iso) parts = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
  else if (dayName && MONTHS[dayName[2]!] !== undefined)
    parts = [Number(dayName[3]), MONTHS[dayName[2]!]!, Number(dayName[1])];
  else if (nameDay && MONTHS[nameDay[1]!] !== undefined)
    parts = [Number(nameDay[3]), MONTHS[nameDay[1]!]!, Number(nameDay[2])];
  if (!parts || parts[1] < 0 || parts[1] > 11 || parts[2] < 1 || parts[2] > 31) return null;
  if (hour > 23 || minute > 59) return null;
  return inBratislava(parts[0], parts[1], parts[2], hour, minute);
}

/** `Eva <eva@ados.sk>; Peter <mailto:p@ados.sk>`: each as `Name <address>`, or the address alone. */
function addressesOf(value: string) {
  const out: string[] = [];
  const pattern =
    /([^,;<[\]]*?)\s*[<[](?:mailto:)?([^\s<>[\]@]+@[^\s<>[\]]+)[>\]]|([^\s,;<>[\]]+@[^\s,;<>[\]]+)/g;
  for (const match of value.matchAll(pattern)) {
    const email = match[2] ?? match[3];
    if (!email) continue;
    const name = match[1]?.replace(/^["'\s]+|["'\s]+$/g, '');
    out.push(name ? `${name} <${email}>` : email);
  }
  return out;
}

const QUOTE_INTRO =
  /(wrote|napisal|napisala|napsal|napsala|schrieb|napisal\(a\)|napsal\(a\)|odoslal|odeslal)\s*:\s*$/;

/** The e-mail's own words: cut at the first sign of what it quotes of the e-mails before it. */
export function ownText(lines: string[]) {
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const here = plain(line).trim();
    if (/^>/.test(line.trimStart()) || MARKER.test(here)) break;
    if (headerOf(line)?.field === 'from' && blockStart(lines.slice(i, i + 8)) === 0) break;
    if (/^(on|dna|am|le|v)\b/.test(here)) {
      if (QUOTE_INTRO.test(here)) break;
      // A long intro wraps onto the next line.
      if (QUOTE_INTRO.test(`${here} ${plain(lines[i + 1] ?? '').trim()}`)) break;
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/** Whether the words before the original's block ask for an import. */
function asksForImport(lines: string[], start: number) {
  const before = start < 0 ? lines : lines.slice(0, start);
  return before.some((line) => plain(line).includes(IMPORT_LINE));
}

/**
 * What a forward says: `asked` when it carries the agreed line, and the original when its block
 * can be read. Asked without a readable original, the e-mail goes on as an ordinary one.
 */
export function readForward(email: { text: string | null; html: string | null }): {
  asked: boolean;
  original: ForwardedEmail | null;
} {
  const source = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : '';
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const start = blockStart(lines);
  if (!asksForImport(lines, start)) return { asked: false, original: null };
  if (start < 0) return { asked: true, original: null };

  const found: Partial<Record<'from' | 'to' | 'cc' | 'subject' | 'date', string>> = {};
  let i = start;
  let last: keyof typeof found | null = null;
  for (; i < lines.length; i += 1) {
    const line = lines[i]!;
    const header = headerOf(line);
    if (header && !found[header.field]) {
      found[header.field] = header.value;
      last = header.field;
    } else if (!line.trim()) {
      // A blank line ends the block once it has something in it.
      if (last) break;
    } else if (last) {
      // A long list of addresses or a long subject wraps.
      found[last] = `${found[last]} ${line.trim()}`;
    }
  }
  const [from] = addressesOf(found.from ?? '');
  const date = parseForwardDate(found.date ?? '');
  if (!from || !date) return { asked: true, original: null };
  return {
    asked: true,
    original: {
      from,
      to: addressesOf(found.to ?? ''),
      cc: addressesOf(found.cc ?? ''),
      subject: (found.subject ?? '').trim(),
      date,
      text: ownText(lines.slice(i + 1)),
    },
  };
}

/** The same original, however often it is forwarded: one key. */
export function importKey(original: ForwardedEmail, fromEmail: string) {
  const words = original.text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 4000);
  return createHash('sha256')
    .update(
      [
        fromEmail,
        original.date.toISOString().slice(0, 16),
        original.subject.toLowerCase().trim(),
        words,
      ].join('\n'),
    )
    .digest('hex');
}
