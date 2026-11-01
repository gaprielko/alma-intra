import { type DefaultTreeAdapterMap, parse, parseFragment, serialize } from 'parse5';
import { SHARE_BRIDGE } from './share-bridge.js';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

const isElement = (node: Node): node is Element => 'tagName' in node;
const isText = (node: Node): node is DefaultTreeAdapterMap['textNode'] => node.nodeName === '#text';
const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)?.value ?? null;

/** Blocks that hold other blocks: they can be selected and deleted, and edited only when they hold text. */
const CONTAINERS = new Set([
  'div',
  'section',
  'article',
  'aside',
  'main',
  'header',
  'footer',
  'nav',
  'details',
  // Lists hold their items, so a paragraph of a contract is a fragment of its own.
  'ul',
  'ol',
  'li',
]);
/** The smallest units of a document ([S-18]); nothing inside them is a fragment of its own. */
const LEAVES = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'blockquote',
  'pre',
  'figure',
  'img',
  'svg',
  'hr',
]);

/** Text that is no reader's to change: code, or something drawn. */
const NO_TEXT = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'svg',
  'math',
  'select',
  'title',
]);
/** These hold other blocks and the editor still takes them whole. */
const RICH_WITH_BLOCKS = new Set(['ul', 'ol', 'li']);

/** What the editor produces, and all that an outsider's fragment can hold ([S-32]). */
const ALLOWED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'colgroup',
  'col',
  'caption',
  'blockquote',
  'pre',
  'code',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'mark',
  'sub',
  'sup',
  'small',
  'span',
  'a',
  'br',
  'hr',
  'img',
  'figure',
  'figcaption',
  'div',
  'section',
  'article',
  'aside',
]);
/** Dropped with all they hold; any other unknown element keeps its content. */
const DROPPED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'math',
  'link',
  'meta',
  'base',
  'noscript',
  'template',
  'video',
  'audio',
  'source',
  'canvas',
  'frame',
  'frameset',
  'title',
]);
const ALLOWED_ATTRS = new Set([
  'class',
  'style',
  'id',
  'href',
  'src',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'scope',
  'width',
  'height',
  'target',
  'rel',
  'start',
  'type',
]);
const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;
const SAFE_STYLE_PROPERTY =
  /^(color|background-color|font-(size|weight|style|family|variant)|line-height|letter-spacing|word-spacing|text-(align|decoration|decoration-line|decoration-color|decoration-style|transform|indent|underline-offset)|white-space|vertical-align|(margin|padding)(-(top|right|bottom|left))?|border(-(top|right|bottom|left))?(-(width|style|color))?|border-(collapse|spacing|radius)|width|min-width|max-width|height|min-height|max-height|display|gap|flex(-(wrap|direction|grow|shrink|basis))?|align-items|justify-content|list-style(-type)?|opacity|overflow-wrap|word-break|--[a-z0-9-]+)$/i;
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|[\\<>]/i;

/** A run of text in the source, without the white space around it. */
export interface TextNode {
  start: number;
  end: number;
  value: string;
}

function textNodesOf(node: ParentNode): TextNode[] {
  return node.childNodes.flatMap((child): TextNode[] => {
    if (isElement(child)) return NO_TEXT.has(child.tagName) ? [] : textNodesOf(child);
    if (!isText(child) || !child.value.trim() || !child.sourceCodeLocation) return [];
    return [
      {
        start: child.sourceCodeLocation.startOffset,
        end: child.sourceCodeLocation.endOffset,
        value: child.value,
      },
    ];
  });
}

/** A fragment of a document: a numbered byte range of its source. */
export interface Fragment {
  block: number;
  tag: string;
  start: number;
  end: number;
  /** Where the attribute goes in the start tag. */
  afterTagName: number;
  container: boolean;
  /** The WYSIWYG editor can hold it without loss. */
  editable: boolean;
  /** Its text, which can be changed in any fragment, with the format left as it is. */
  texts: TextNode[];
  parent: number | null;
}

function childrenOf(node: ParentNode): Node[] {
  // A `template`'s content is inert, and no fragment lives there.
  return node.childNodes;
}

function bodyOf(document: DefaultTreeAdapterMap['document']): Element | null {
  const html = document.childNodes.find((n) => isElement(n) && n.tagName === 'html') as
    Element | undefined;
  return (html?.childNodes.find((n) => isElement(n) && n.tagName === 'body') as Element) ?? null;
}

const hasDirectText = (el: Element) =>
  el.childNodes.some((n) => isText(n) && n.value.trim().length > 0);

function holdsBlocks(el: Element): boolean {
  return el.childNodes.some(
    (n) =>
      isElement(n) && (LEAVES.has(n.tagName) || CONTAINERS.has(n.tagName)) && n.tagName !== 'img',
  );
}

/**
 * The document's fragments in source order. Numbers are ordinals, the same for the same source, so a
 * number from the client means one thing as long as the version it was read from is known. Elements
 * without a place in the source (an implied `tbody`, a fostered node) are skipped.
 */
export function parseFragments(source: string): Fragment[] {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const body = bodyOf(document);
  if (!body) return [];
  const fragments: Fragment[] = [];
  const walk = (node: ParentNode, parent: number | null) => {
    for (const child of childrenOf(node)) {
      if (!isElement(child)) continue;
      const leaf = LEAVES.has(child.tagName);
      const container = CONTAINERS.has(child.tagName);
      const location = child.sourceCodeLocation;
      if (!(leaf || container) || !location) {
        walk(child, parent);
        continue;
      }
      const fragment: Fragment = {
        block: fragments.length,
        tag: child.tagName,
        start: location.startOffset,
        end: location.endOffset,
        afterTagName: location.startOffset + 1 + child.tagName.length,
        container: container && holdsBlocks(child),
        editable: false,
        texts: textNodesOf(child),
        parent,
      };
      fragments.push(fragment);
      const slice = source.slice(fragment.start, fragment.end);
      fragment.editable =
        (!fragment.container || RICH_WITH_BLOCKS.has(child.tagName)) &&
        !['img', 'svg', 'hr', 'figure'].includes(child.tagName) &&
        (leaf || hasDirectText(child) || slice.replace(/<[^>]*>/g, '').trim().length > 0) &&
        losslessThroughSanitizer(slice);
      if (container) walk(child, fragment.block);
    }
  };
  walk(body, null);
  return fragments;
}

function safeStyle(value: string): string | null {
  const kept = value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 1) return false;
      const property = declaration.slice(0, colon).trim();
      const val = declaration.slice(colon + 1);
      return SAFE_STYLE_PROPERTY.test(property) && !UNSAFE_STYLE_VALUE.test(val);
    });
  return kept.length > 0 ? kept.join('; ') : null;
}

function imageSources(html: string): Set<string> {
  const sources = new Set<string>();
  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      if (child.tagName === 'img') {
        const src = attr(child, 'src');
        if (src !== null) sources.add(src);
      }
      walk(child);
    }
  };
  walk(parseFragment(html));
  return sources;
}

function cleanTree(node: ParentNode, sources: Set<string> | null) {
  const next: typeof node.childNodes = [];
  for (const child of node.childNodes) {
    if (child.nodeName === '#comment' || child.nodeName === '#documentType') continue;
    if (!isElement(child)) {
      next.push(child);
      continue;
    }
    if (DROPPED_TAGS.has(child.tagName)) continue;
    cleanTree(child, sources);
    if (!ALLOWED_TAGS.has(child.tagName)) {
      // Only its content stays.
      for (const inner of child.childNodes) inner.parentNode = node;
      next.push(...child.childNodes);
      continue;
    }
    if (child.tagName === 'img') {
      // No new picture from outside: only one the fragment already had.
      const src = attr(child, 'src');
      if (sources !== null && (src === null || !sources.has(src))) continue;
    }
    child.attrs = child.attrs.flatMap((a) => {
      if (!ALLOWED_ATTRS.has(a.name) || a.prefix || a.namespace) return [];
      if (a.name === 'href' && !SAFE_HREF.test(a.value.trim())) return [];
      if (a.name === 'style') {
        const style = safeStyle(a.value);
        return style === null ? [] : [{ ...a, value: style }];
      }
      if (a.name === 'target' && a.value !== '_blank') return [];
      return [a];
    });
    next.push(child);
  }
  node.childNodes = next;
}

/**
 * An outsider's HTML reduced to what the allow-list holds. `oldHtml`: the fragment it replaces, the
 * only place a picture can come from. Parsed and serialized twice, so what a browser reads later is
 * what was checked.
 */
export function sanitizeFragment(html: string, oldHtml: string | null = null): string {
  const sources = oldHtml === null ? null : imageSources(oldHtml);
  const once = (input: string) => {
    const tree = parseFragment(input);
    cleanTree(tree, sources);
    return serialize(tree);
  };
  return once(once(html)).trim();
}

const canonical = (html: string) => serialize(parseFragment(html)).trim();

/** Whether the sanitizer would keep a fragment as it is; otherwise it cannot go through the editor. */
function losslessThroughSanitizer(html: string) {
  const styleFree = (value: string) => value.replace(/\sstyle="[^"]*"/g, '');
  const before = canonical(html);
  const after = sanitizeFragment(html);
  if (before === after) return true;
  // `safeStyle` writes declarations its own way; only a dropped one is a loss.
  if (styleFree(before) !== styleFree(after)) return false;
  return !/\sstyle="[^"]*(url\s*\(|position\s*:)/i.test(before);
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

function applySplices(source: string, splices: Splice[]) {
  const ordered = [...splices].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let at = 0;
  for (const splice of ordered) {
    if (splice.start < at) continue;
    out += source.slice(at, splice.start) + splice.text;
    at = splice.end;
  }
  return out + source.slice(at);
}

/** What a resolved change does to the document it is shown or applied on. */
export interface PlacedChange {
  id: string | null;
  block: number;
  html: string | null;
}

/** A version's bytes with these changes: everything else stays byte for byte. */
export function applyChanges(source: string, changes: { block: number; html: string | null }[]) {
  const fragments = parseFragments(source);
  return applySplices(
    source,
    changes.flatMap((change) => {
      const fragment = fragments[change.block];
      return fragment
        ? [{ start: fragment.start, end: fragment.end, text: change.html ?? '' }]
        : [];
    }),
  );
}

export interface StoredChange {
  id: string;
  oldHtml: string;
  newHtml: string | null;
}

export interface ResolvedChanges {
  /** Each change with the fragment it now applies to. */
  placed: (StoredChange & { block: number })[];
  /** „Zmena sa už nedá zaradiť“: its original fragment is no longer in the document. */
  unplaced: StoredChange[];
}

/**
 * Finds each change's fragment in this version by its original source. Several changes of one
 * fragment are alternatives and all placed there. A change inside a fragment another change replaces
 * has no place of its own.
 */
export function resolveChanges(source: string, changes: StoredChange[]): ResolvedChanges {
  const fragments = parseFragments(source);
  const bySource = new Map<string, Fragment[]>();
  for (const fragment of fragments) {
    const slice = source.slice(fragment.start, fragment.end);
    bySource.set(slice, [...(bySource.get(slice) ?? []), fragment]);
  }
  const taken = new Map<string, number>();
  const placedRaw: (StoredChange & { fragment: Fragment })[] = [];
  const unplaced: StoredChange[] = [];
  for (const change of changes) {
    const candidates = bySource.get(change.oldHtml);
    if (!candidates) {
      unplaced.push(change);
      continue;
    }
    // Two equal paragraphs: alternatives share the first, until a different new text needs another.
    const key = `${change.oldHtml}\u0000${change.newHtml ?? ''}`;
    const used = taken.get(key) ?? 0;
    taken.set(key, used + 1);
    const fragment = candidates[Math.min(used, candidates.length - 1)]!;
    placedRaw.push({ ...change, fragment });
  }
  const placed: ResolvedChanges['placed'] = [];
  for (const change of placedRaw) {
    const nested = placedRaw.some(
      (other) =>
        other !== change &&
        other.fragment.start <= change.fragment.start &&
        other.fragment.end >= change.fragment.end &&
        other.fragment.block !== change.fragment.block,
    );
    if (nested) {
      unplaced.push({ id: change.id, oldHtml: change.oldHtml, newHtml: change.newHtml });
      continue;
    }
    placed.push({
      id: change.id,
      oldHtml: change.oldHtml,
      newHtml: change.newHtml,
      block: change.fragment.block,
    });
  }
  return { placed, unplaced };
}

/** Removed from what is shown, never from the file ([S-11], [S-13]). */
function strippedRanges(source: string): Splice[] {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const ranges: Splice[] = [];
  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      const location = child.sourceCodeLocation;
      const googleFont =
        child.tagName === 'link' &&
        /fonts\.(googleapis|gstatic)\.com/i.test(attr(child, 'href') ?? '');
      const editBar = child.tagName === 'script' && attr(child, 'id') === 'alma-edit';
      const refresh = child.tagName === 'meta' && attr(child, 'http-equiv') !== null;
      if (location && (googleFont || editBar || refresh || child.tagName === 'base')) {
        ranges.push({ start: location.startOffset, end: location.endOffset, text: '' });
        continue;
      }
      walk(child);
    }
  };
  walk(document);
  return ranges;
}

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Marks a changed fragment's new HTML, or stands in for a deleted one. */
function markChange(change: PlacedChange, number: number): string {
  const id = escapeAttr(change.id ?? '');
  if (change.html === null) {
    return `<div data-alma-gone="${id}" data-alma-n="${number}"></div>`;
  }
  const tree = parseFragment(change.html);
  const first = tree.childNodes.find(isElement);
  if (!first) return change.html;
  first.attrs.push({ name: 'data-alma-change', value: change.id ?? '' });
  first.attrs.push({ name: 'data-alma-n', value: String(number) });
  return serialize(tree);
}

/**
 * The document as the frame gets it: fragments numbered, what must not show removed, our bridge
 * first, and `changes` in place. Only ever served under the frame's policy (`share-frame.controller`).
 */
export function framePage(
  source: string,
  options: { mode: 'read' | 'comment' | 'edit' | 'draft'; changes?: PlacedChange[] },
): string {
  const fragments = parseFragments(source);
  const changes = options.changes ?? [];
  const splices = strippedRanges(source);
  const replaced = changes
    .map((change) => ({ change, fragment: fragments[change.block] }))
    .filter((c): c is { change: PlacedChange; fragment: Fragment } => c.fragment !== undefined);
  // Alternatives of one fragment: the document shows the first, the panel all of them.
  const numbers = new Map<string, number>();
  changes.forEach((change, i) => numbers.set(change.id ?? String(i), i + 1));
  const seen = new Set<number>();
  for (const { change, fragment } of replaced) {
    if (seen.has(fragment.block)) continue;
    seen.add(fragment.block);
    splices.push({
      start: fragment.start,
      end: fragment.end,
      text: markChange(change, numbers.get(change.id ?? '') ?? 0),
    });
  }
  for (const fragment of fragments) {
    if (
      replaced.some((r) => r.fragment.start <= fragment.start && r.fragment.end >= fragment.end)
    ) {
      continue;
    }
    const marks = [
      ` data-alma-b="${fragment.block}"`,
      fragment.editable ? ' data-alma-e="1"' : '',
      fragment.texts.length > 0 ? ' data-alma-x="1"' : '',
    ].join('');
    splices.push({ start: fragment.afterTagName, end: fragment.afterTagName, text: marks });
  }
  const page = applySplices(source, splices);
  const bridge = `<script>${SHARE_BRIDGE.replace('__MODE__', options.mode)}</script>`;
  // Before the document's own scripts; a parser puts a script before `<html>` into the head anyway.
  const head = /<head(\s[^>]*)?>/i.exec(page);
  if (head) {
    const at = head.index + head[0].length;
    return page.slice(0, at) + bridge + page.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(page);
  const at = doctype ? doctype[0].length : 0;
  return page.slice(0, at) + bridge + page.slice(at);
}

const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A run of text as it stands in the source, split from the white space around it. */
function coreOf(source: string, node: TextNode) {
  const raw = source.slice(node.start, node.end);
  const before = /^\s*/.exec(raw)![0];
  const after = /\s*$/.exec(raw)![0];
  return { before, core: raw.slice(before.length, raw.length - after.length), after };
}

/**
 * One fragment for the editor. `html` for the WYSIWYG editor where it can hold it. `textHtml` for
 * any fragment with text: the same source with each run of text a field of its own, so nothing but
 * words can change. Only ever shown in the editor's frame, which runs no script.
 */
export function fragmentForEditor(source: string, block: number) {
  const fragment = parseFragments(source)[block];
  if (!fragment || (!fragment.editable && fragment.texts.length === 0)) return null;
  const textHtml =
    fragment.texts.length === 0
      ? null
      : applySplices(
          source.slice(fragment.start, fragment.end),
          fragment.texts.map((node, i) => {
            const { before, core, after } = coreOf(source, node);
            return {
              start: node.start - fragment.start,
              end: node.end - fragment.start,
              text: `${before}<span data-alma-t="${i}" contenteditable="plaintext-only">${core}</span>${after}`,
            };
          }),
        );
  return {
    html: fragment.editable ? source.slice(fragment.start, fragment.end) : null,
    textHtml,
    tag: fragment.tag,
  };
}

/**
 * A fragment with only its words changed: every other byte stays, whatever it holds, and what was
 * typed can only ever be text.
 */
export function withTexts(
  source: string,
  fragment: Fragment,
  texts: { i: number; text: string }[],
) {
  const edits: Splice[] = [];
  for (const { i, text } of texts) {
    const node = fragment.texts[i];
    if (!node) continue;
    const { before, after } = coreOf(source, node);
    if (text.trim() === node.value.trim()) continue;
    edits.push({ start: node.start, end: node.end, text: `${before}${escapeText(text)}${after}` });
  }
  const ordered = edits.map((edit) => ({
    start: edit.start - fragment.start,
    end: edit.end - fragment.start,
    text: edit.text,
  }));
  return applySplices(source.slice(fragment.start, fragment.end), ordered);
}

/** The markup of a fragment without its words. */
function markupOf(html: string) {
  const tree = parseFragment(html);
  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (isElement(child)) {
        if (!NO_TEXT.has(child.tagName)) walk(child);
      } else if (isText(child)) {
        child.value = '';
      }
    }
  };
  walk(tree);
  return serialize(tree);
}

/**
 * What goes into a version. A change of words alone keeps the fragment's markup, which is the
 * document's own and may hold what the sanitizer would drop; anything else goes through it.
 */
export function safeNewHtml(newHtml: string, oldHtml: string) {
  return markupOf(newHtml) === markupOf(oldHtml) ? newHtml : sanitizeFragment(newHtml, oldHtml);
}

export function documentStyles(source: string): string {
  const document = parse(source);
  const styles: string[] = [];
  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      if (child.tagName === 'style') {
        for (const text of child.childNodes) if (isText(text)) styles.push(text.value);
        continue;
      }
      walk(child);
    }
  };
  walk(document);
  return styles.join('\n');
}
