import { fileExtension } from '@intra/shared/schemas';
import PizZip from 'pizzip';

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
 * The text of a file Claude can read here (TXT, MD, CSV, DOCX), or null for the others: those it
 * downloads and opens with its own document tools.
 */
export function extractText(
  name: string,
  bytes: Uint8Array,
): { text: string; cut: boolean } | null {
  const ext = fileExtension(name);
  let text: string;
  if (ext === 'txt' || ext === 'md' || ext === 'csv') text = new TextDecoder().decode(bytes);
  else if (ext === 'docx') text = docxText(bytes);
  else return null;
  const cut = text.length > MAX_TEXT_CHARS;
  return { text: cut ? text.slice(0, MAX_TEXT_CHARS) : text, cut };
}
