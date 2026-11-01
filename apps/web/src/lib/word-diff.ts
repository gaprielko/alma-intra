export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };

/** Words and the space after them, so a diff keeps its spacing. */
const tokens = (text: string) => text.match(/\S+\s*|\s+/g) ?? [];

const CELL_LIMIT = 4_000_000;

/**
 * What changed between two texts, word by word (longest common subsequence). A pair too long for
 * that shows as one removal and one addition.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > CELL_LIMIT) {
    return [
      { kind: 'removed', text: before },
      { kind: 'added', text: after },
    ];
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i]!.trim() === b[j]!.trim()
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i]!.trim() === b[j]!.trim()) {
      push('same', b[j]!);
      i += 1;
      j += 1;
    } else if (
      j < b.length &&
      (i === a.length || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)
    ) {
      push('added', b[j]!);
      j += 1;
    } else {
      push('removed', a[i]!);
      i += 1;
    }
  }
  return parts;
}

const BLOCKS = 'p,li,td,th,tr,h1,h2,h3,h4,h5,h6,div,section,blockquote,pre,figcaption,br';

/**
 * The text of an HTML fragment, its cells and paragraphs apart. A parsed document that is never
 * attached runs and loads nothing.
 */
export function htmlText(html: string | null): string {
  if (!html) return '';
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  body.querySelectorAll(BLOCKS).forEach((el) => el.append(' '));
  return (body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
