import { fileExtension } from '@intra/shared/schemas';
import PizZip from 'pizzip';
import readXlsxFile from 'read-excel-file/node';
import { extractText as pdfPages, getDocumentProxy } from 'unpdf';

/** What Claude gets to read of one file, at most: longer text is cut and says so. */
export const MAX_TEXT_CHARS = 200_000;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const decode = (xml: string) =>
  xml
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]!);

/** The paragraphs of a DOCX's main text, tables row by row; no formatting. */
export function docxText(bytes: Uint8Array) {
  const xml = new PizZip(bytes).file('word/document.xml')?.asText() ?? '';
  return decode(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The text layer of a PDF, page by page under „--- Page N ---“. A scan without one gives no text.
 */
export async function pdfText(bytes: Uint8Array) {
  // pdf.js takes the buffer over; it gets a copy so the caller's bytes stay usable.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { text } = await pdfPages(pdf, { mergePages: false });
    return text
      .map((page, i) => `--- Page ${i + 1} ---\n${page.trim()}`)
      .join('\n\n')
      .trim();
  } finally {
    await pdf.loadingTask.destroy();
  }
}

const cell = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().replace(/T00:00:00\.000Z$/, '')
    : typeof value === 'string'
      ? value.replace(/[\t\r\n]+/g, ' ')
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';

/** Every sheet of an XLSX under „--- Sheet: name ---“, one row per line, cells tab-separated. */
export async function xlsxText(bytes: Uint8Array) {
  const sheets = await readXlsxFile(Buffer.from(bytes));
  return sheets
    .map(({ sheet, data }) => {
      const rows = data.map((row) => row.map(cell).join('\t').replace(/\t+$/, ''));
      return `--- Sheet: ${sheet} ---\n${rows.join('\n').trim()}`;
    })
    .join('\n\n')
    .trim();
}

/**
 * The text of a file Claude can read here (TXT, MD, CSV, DOCX, PDF, XLSX), or null for the
 * others: those it downloads and opens with its own document tools.
 */
export async function extractText(
  name: string,
  bytes: Uint8Array,
): Promise<{ text: string; cut: boolean } | null> {
  const ext = fileExtension(name);
  let text: string;
  if (ext === 'txt' || ext === 'md' || ext === 'csv') text = new TextDecoder().decode(bytes);
  else if (ext === 'docx') text = docxText(bytes);
  else if (ext === 'pdf') text = await pdfText(bytes);
  else if (ext === 'xlsx') text = await xlsxText(bytes);
  else return null;
  const cut = text.length > MAX_TEXT_CHARS;
  return { text: cut ? text.slice(0, MAX_TEXT_CHARS) : text, cut };
}
