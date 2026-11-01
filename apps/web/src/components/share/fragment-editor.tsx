import { sk } from '@intra/shared/i18n';
import { Extension, Mark } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const t = sk.sharing.editor;

/** A document's `class` and `style` survive the editor (docs/file-sharing.md, [S-20]). */
const KeepStyling = Extension.create({
  name: 'keepStyling',
  addGlobalAttributes: () => [
    {
      types: [
        'paragraph',
        'heading',
        'bulletList',
        'orderedList',
        'listItem',
        'blockquote',
        'codeBlock',
        'table',
        'tableRow',
        'tableCell',
        'tableHeader',
      ],
      attributes: {
        class: {
          default: null,
          parseHTML: (el) => el.getAttribute('class'),
          renderHTML: (attrs) => (attrs.class ? { class: attrs.class as string } : {}),
        },
        style: {
          default: null,
          parseHTML: (el) => el.getAttribute('style'),
          renderHTML: (attrs) => (attrs.style ? { style: attrs.style as string } : {}),
        },
      },
    },
  ],
});

const StyledSpan = Mark.create({
  name: 'styledSpan',
  addAttributes: () => ({
    class: {
      default: null,
      parseHTML: (el) => el.getAttribute('class'),
      renderHTML: (attrs) => (attrs.class ? { class: attrs.class as string } : {}),
    },
    style: {
      default: null,
      parseHTML: (el) => el.getAttribute('style'),
      renderHTML: (attrs) => (attrs.style ? { style: attrs.style as string } : {}),
    },
  }),
  parseHTML: () => [{ tag: 'span' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});

const extensions = [
  StarterKit.configure({
    // An empty paragraph after a table would become part of the fragment.
    trailingNode: false,
    link: {
      openOnClick: false,
      autolink: true,
      protocols: ['https', 'http', 'mailto', 'tel'],
      HTMLAttributes: { rel: null, target: null, class: null },
    },
  }),
  Table.configure({ resizable: false, renderWrapper: false }),
  TableRow,
  TableHeader,
  TableCell,
  KeepStyling,
  StyledSpan,
];

/** Whatever the editor adds around a table and its cells, gone again. */
function normalize(html: string, hadHead: boolean) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('colgroup').forEach((el) => el.remove());
  doc.querySelectorAll('table').forEach((table) => {
    const style = (table.getAttribute('style') ?? '')
      .replace(/min-width:\s*[^;]+;?\s*/g, '')
      .trim();
    if (style) table.setAttribute('style', style);
    else table.removeAttribute('style');
    if (!hadHead) return;
    const body = table.tBodies[0];
    const first = body?.rows[0];
    if (body && first && [...first.cells].every((cell) => cell.tagName === 'TH')) {
      table.createTHead().append(first);
    }
  });
  doc.querySelectorAll('li, td, th').forEach((cell) => {
    const only = cell.children.length === 1 ? cell.children[0] : null;
    if (only?.tagName === 'P' && only.attributes.length === 0 && cell.childNodes.length === 1) {
      only.replaceWith(...only.childNodes);
    }
  });
  return doc.body.innerHTML;
}

const SAME_TAG: Record<string, string> = { b: 'strong', i: 'em', strike: 's', del: 's' };
const IGNORED = new Set(['tbody', 'thead', 'tfoot', 'colgroup', 'col']);

/** What must survive: elements, their class and style, addresses, pictures and the words. */
function signature(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const steps: string[] = [];
  const walk = (node: Element) => {
    for (const child of node.children) {
      const tag = child.tagName.toLowerCase();
      if (!IGNORED.has(tag)) {
        const style = (child.getAttribute('style') ?? '').replace(/[\s;]/g, '').toLowerCase();
        steps.push(
          [
            SAME_TAG[tag] ?? tag,
            child.getAttribute('class') ?? '',
            style,
            child.getAttribute('href') ?? '',
          ].join('|'),
        );
      }
      walk(child);
    }
  };
  walk(doc.body);
  const words = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  return JSON.stringify([steps, words]);
}

/** A `div` or `section` of text: its own tag stays, only what is inside goes through the editor. */
function splitOuter(html: string, tag: string) {
  if (
    !['div', 'section', 'article', 'aside', 'main', 'header', 'footer', 'nav', 'details'].includes(
      tag,
    )
  ) {
    return null;
  }
  const open = /^<[^>]*>/.exec(html)?.[0] ?? `<${tag}>`;
  const inner = html.slice(open.length).replace(new RegExp(`</${tag}\\s*>\\s*$`, 'i'), '');
  return { open, inner, close: `</${tag}>` };
}

function unwrapSingle(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const only = doc.body.children.length === 1 ? doc.body.children[0] : null;
  return only?.tagName === 'P' && only.attributes.length === 0 ? only.innerHTML : html;
}

function outputOf(editor: Editor, source: string, tag: string) {
  const hadHead = /<thead/i.test(source);
  const outer = splitOuter(source, tag);
  const body = normalize(editor.getHTML(), hadHead);
  return outer ? `${outer.open}${unwrapSingle(body)}${outer.close}` : body;
}

function FrameTool({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active ?? false}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border bg-white px-1.5 text-xs font-medium',
        active && 'border-primary bg-primary-soft text-primary-text',
      )}
    >
      {children}
    </button>
  );
}

const policy =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:";

/**
 * The WYSIWYG editor over a fragment. It lives in a frame of its own without scripts, holding only
 * the document's styles, so the text looks as it does in the document while the document's scripts
 * have no access to it. The page's code reaches in and runs the editor, as the file preview does.
 * `source` comes from the server. A fragment that would lose anything on the way through refuses.
 */
export function FragmentEditor({
  source,
  tag,
  styles,
  onSave,
  onCancel,
  onRefuse,
}: {
  source: string;
  tag: string;
  styles: string;
  /** Only when something changed: otherwise it is `onCancel`. */
  onSave: (html: string, text: string) => void;
  onCancel: () => void;
  onRefuse: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [height, setHeight] = useState(160);
  const [, repaint] = useState(0);
  const [linking, setLinking] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const outer = splitOuter(source, tag);
  // A style holding `</style` could not have come through a parser as one element.
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${styles.replace(/<\/style/gi, '')}</style><style>body{margin:0;padding:12px;background:#fff}.ProseMirror{outline:none;min-height:48px}</style></head><body><div id="editor"></div></body></html>`;

  useEffect(() => () => editor?.destroy(), [editor]);

  const mount = () => {
    const inside = frame.current?.contentDocument;
    const element = inside?.getElementById('editor');
    if (!element || editor) return;
    const created = new Editor({
      element,
      extensions,
      content: outer ? outer.inner : source,
      onTransaction: () => repaint((n) => n + 1),
      onUpdate: () => setHeight(inside!.documentElement.scrollHeight),
    });
    if (signature(outputOf(created, source, tag)) !== signature(source)) {
      created.destroy();
      onRefuse();
      return;
    }
    setHeight(Math.max(120, inside!.documentElement.scrollHeight));
    setEditor(created);
    created.commands.focus('end');
  };

  const inTable = editor?.isActive('table') ?? false;
  const link = () => {
    if (!editor) return;
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    setLinking(true);
  };
  const applyLink = () => {
    const href = linkHref.trim();
    if (editor && /^(https?:|mailto:|tel:)/i.test(href)) {
      editor.chain().focus().setLink({ href }).run();
    }
    setLinking(false);
    setLinkHref('');
  };

  return (
    <section
      aria-label={t.label}
      className="overflow-hidden rounded-xl border border-border-subtle bg-white shadow-[0_12px_32px_rgba(12,43,44,0.25)]"
    >
      <div
        role="toolbar"
        className="flex flex-wrap gap-1 border-b border-border-subtle bg-surface p-1.5"
      >
        <FrameTool
          label={t.bold}
          active={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="size-4" aria-hidden />
        </FrameTool>
        <FrameTool
          label={t.italic}
          active={editor?.isActive('italic') ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-4" aria-hidden />
        </FrameTool>
        <FrameTool
          label={t.list}
          active={editor?.isActive('bulletList') ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" aria-hidden />
        </FrameTool>
        <FrameTool
          label={t.orderedList}
          active={editor?.isActive('orderedList') ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" aria-hidden />
        </FrameTool>
        <FrameTool label={t.link} active={editor?.isActive('link') ?? false} onClick={link}>
          <Link2 className="size-4" aria-hidden />
        </FrameTool>
        {inTable ? (
          <>
            <FrameTool label={t.addRow} onClick={() => editor?.chain().focus().addRowAfter().run()}>
              {t.addRow}
            </FrameTool>
            <FrameTool
              label={t.deleteRow}
              onClick={() => editor?.chain().focus().deleteRow().run()}
            >
              {t.deleteRow}
            </FrameTool>
            <FrameTool
              label={t.addColumn}
              onClick={() => editor?.chain().focus().addColumnAfter().run()}
            >
              {t.addColumn}
            </FrameTool>
            <FrameTool
              label={t.deleteColumn}
              onClick={() => editor?.chain().focus().deleteColumn().run()}
            >
              {t.deleteColumn}
            </FrameTool>
          </>
        ) : null}
      </div>
      {linking ? (
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border-subtle p-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            aria-label={t.linkPrompt}
            placeholder={t.linkPrompt}
            value={linkHref}
            onChange={(event) => setLinkHref(event.target.value)}
            className="h-8 min-w-[12rem] flex-1 rounded-lg border border-border px-2 text-sm"
          />
          <Button type="submit" size="sm">
            {t.linkApply}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setLinking(false)}>
            {t.cancel}
          </Button>
        </form>
      ) : null}
      <iframe
        ref={frame}
        title={t.label}
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        onLoad={mount}
        style={{ height: Math.min(height, 420) }}
        className="block w-full border-0 bg-white"
      />
      <div className="flex justify-end gap-2 border-t border-border-subtle p-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button
          size="sm"
          disabled={!editor}
          onClick={() => {
            if (!editor) return;
            const output = outputOf(editor, source, tag);
            if (signature(output) === signature(source)) onCancel();
            else onSave(output, editor.getText());
          }}
        >
          {t.save}
        </Button>
      </div>
    </section>
  );
}
