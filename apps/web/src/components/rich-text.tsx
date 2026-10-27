import { sk } from '@intra/shared/i18n';
import type { RichText } from '@intra/shared/schemas';
import { EditorContent, type JSONContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const t = sk.activities.editor;

/**
 * Only what the API accepts (`richTextSchema`): paragraphs, bold, italic, the two lists, links and
 * line breaks. Headings, quotes, code, strikes and underlines are switched off, so nothing typed
 * or pasted can become something the server refuses.
 */
const extensions = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: {
      openOnClick: false,
      autolink: true,
      protocols: ['https', 'http', 'mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    },
  }),
];

/** The look of a document, in the editor and when it is only shown. */
const proseClass =
  'text-sm leading-[21px] [&_a]:text-primary-text [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_p+ul]:mt-2 [&_p+ol]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li+li]:mt-0.5';

const isEmpty = (doc: JSONContent) => !JSON.stringify(doc).includes('"text"');

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // The editor keeps its selection while the toolbar is clicked.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-foreground',
        active && 'bg-primary-soft text-primary-text',
      )}
    >
      {children}
    </button>
  );
}

/** The notes of an activity: a small editor with a toolbar. `null` while it is empty. */
export function RichTextEditor({
  value,
  onChange,
  labelledBy,
  placeholder = t.placeholder,
}: {
  value: RichText | null;
  onChange: (value: RichText | null) => void;
  labelledBy?: string;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions,
    content: (value as JSONContent | null) ?? '',
    editorProps: {
      attributes: {
        class: cn(proseClass, 'min-h-[120px] px-3.5 py-3 outline-none'),
        ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
        'aria-multiline': 'true',
        role: 'textbox',
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor: current }) => {
      const doc = current.getJSON();
      onChange(isEmpty(doc) ? null : (doc as RichText));
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      bulletList: current?.isActive('bulletList') ?? false,
      orderedList: current?.isActive('orderedList') ?? false,
      link: current?.isActive('link') ?? false,
      empty: current?.isEmpty ?? true,
    }),
  });

  // The address of a new link is typed in a row under the toolbar, not in a browser popup.
  const [linking, setLinking] = useState<string | null>(null);
  const toggleLink = () => {
    if (!editor) return;
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    setLinking('https://');
  };
  const applyLink = () => {
    const href = linking?.trim() ?? '';
    setLinking(null);
    if (!editor || !/^(https?:\/\/|mailto:)/i.test(href) || href === 'https://') return;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-border focus-within:border-primary">
      <div
        role="toolbar"
        aria-label={t.toolbar}
        className="flex gap-0.5 border-b border-border-subtle bg-surface p-1.5"
      >
        <ToolButton
          label={t.bold}
          active={state?.bold ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label={t.italic}
          active={state?.italic ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label={t.bulletList}
          active={state?.bulletList ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label={t.orderedList}
          active={state?.orderedList ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label={t.link} active={state?.link ?? false} onClick={toggleLink}>
          <Link2 className="size-4" aria-hidden />
        </ToolButton>
      </div>
      {linking !== null ? (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-surface px-2 pb-2">
          <input
            autoFocus
            aria-label={t.linkPrompt}
            value={linking}
            onChange={(event) => setLinking(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setLinking(null);
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 text-[13px] outline-none focus:border-primary"
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => setLinking(null)}>
            {sk.common.cancel}
          </Button>
          <Button type="button" size="sm" onClick={applyLink}>
            {t.linkApply}
          </Button>
        </div>
      ) : null}
      {state?.empty ? (
        <p
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-3.5 text-sm text-tertiary',
            linking === null ? 'top-[53px]' : 'top-[95px]',
          )}
        >
          {placeholder}
        </p>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * A stored document, shown. Rendered by the same schema as the editor, read-only, so nothing in
 * it becomes markup the editor would not make.
 */
export function RichTextView({ value, className }: { value: RichText; className?: string }) {
  const editor = useEditor({
    extensions,
    content: value as JSONContent,
    editable: false,
    editorProps: { attributes: { class: cn(proseClass, 'outline-none', className) } },
  });
  return <EditorContent editor={editor} />;
}
