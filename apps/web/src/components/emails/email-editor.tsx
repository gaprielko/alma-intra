import { sk } from '@intra/shared/i18n';
import {
  type CustomField,
  type EmailLook,
  type EmailNode,
  SYSTEM_VARIABLES,
} from '@intra/shared/schemas';
import {
  type Editor,
  EditorContent,
  type JSONContent,
  Node,
  useEditor,
  useEditorState,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Braces,
  Columns2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  SquareDashed,
} from 'lucide-react';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import {
  Callout,
  Column,
  Columns,
  EmailButton,
  EmailEditorContext,
  type EmailEditorContextValue,
  EmailImage,
  Variable,
} from '@/components/emails/email-nodes';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ImageNotAllowed, uploadEmailImage } from '@/lib/email-images';
import { cn } from '@/lib/utils';

const t = sk.templates;
const v = t.variables;

/** The name of a variable for people: „Oslovenie“, „Počet sestier“. */
export function variableLabel(name: string, fields: readonly CustomField[]): string {
  if (name.startsWith('custom.')) {
    return fields.find((f) => `custom.${f.key}` === name)?.label ?? name;
  }
  return (v as Record<string, unknown>)[name] as string;
}

const LINK = {
  openOnClick: false,
  autolink: true,
  protocols: ['https', 'http', 'mailto'],
};

/** The body: the blocks of D-25 and nothing else, so what is typed is what the API accepts. */
const bodyExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    strike: false,
    underline: false,
    link: LINK,
  }),
  Variable,
  EmailButton,
  Callout,
  Column,
  Columns,
  EmailImage,
];

/** The subject: one line of text and variables. */
const SubjectDoc = Node.create({ name: 'doc', topNode: true, content: 'paragraph' });
const subjectExtensions = [
  StarterKit.configure({
    document: false,
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    hardBreak: false,
    bold: false,
    italic: false,
    strike: false,
    underline: false,
    link: false,
    trailingNode: false,
  }),
  SubjectDoc,
  Variable,
];

const variableGroups = (fields: readonly CustomField[]) => [
  {
    label: v.groups.contact,
    names: SYSTEM_VARIABLES.filter((n) => n === 'salutation' || n.startsWith('contact.')),
  },
  { label: v.groups.customer, names: SYSTEM_VARIABLES.filter((n) => n.startsWith('customer.')) },
  { label: v.groups.sender, names: SYSTEM_VARIABLES.filter((n) => n.startsWith('sender.')) },
  { label: v.groups.custom, names: fields.map((f) => `custom.${f.key}`) },
];

/** „Vložiť premennú“: the variables by group, inserted as chips where the cursor is. */
function VariableMenu({
  editor,
  fields,
  compact = false,
}: {
  editor: Editor | null;
  fields: readonly CustomField[];
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-primary-text hover:bg-primary-soft',
            !compact && 'ml-auto',
          )}
        >
          <Braces className="size-4" aria-hidden />
          {t.editor.variable}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 min-w-56 overflow-y-auto">
        {variableGroups(fields).map((group, i) => (
          <div key={group.label}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.names.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted">{v.noCustomFields}</p>
            ) : (
              group.names.map((name) => (
                <DropdownMenuItem
                  key={name}
                  onSelect={() =>
                    editor
                      ?.chain()
                      .focus()
                      .insertContent({ type: 'variable', attrs: { name } })
                      .run()
                  }
                >
                  {variableLabel(name, fields)}
                </DropdownMenuItem>
              ))
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ToolButton({
  label,
  active = false,
  onClick,
  children,
  wide = false,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={wide ? undefined : label}
      aria-pressed={active}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold text-muted transition-colors hover:bg-hover hover:text-foreground',
        wide ? 'px-2.5' : 'w-8',
        active && 'bg-primary-soft text-primary-text',
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px bg-border" />;

/** The text box under the toolbar where a link's address or a button's is typed. */
function ButtonDialog({
  initial,
  onClose,
  onSave,
  onRemove,
}: {
  initial: { text: string; href: string };
  onClose: () => void;
  onSave: (attrs: { text: string; href: string }) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(initial.text);
  const [href, setHref] = useState(initial.href);
  const valid = text.trim() !== '' && /^(https?:\/\/|mailto:)./i.test(href.trim());
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.editor.buttonDialog}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onSave({ text: text.trim(), href: href.trim() });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="button-text">{t.editor.buttonText}</Label>
            <Input
              id="button-text"
              autoFocus
              maxLength={80}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="button-href">{t.editor.buttonHref}</Label>
            <Input
              id="button-href"
              maxLength={2000}
              value={href}
              onChange={(e) => setHref(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-danger"
              onClick={onRemove}
            >
              {t.editor.remove}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={!valid}>
              {sk.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The body editor inside the real layout (D-11): the company header, the body, the sender's
 * signature and the footer, in the look of Settings › Vzhľad e-mailov. What is edited is what
 * arrives; the preview renders the exact HTML.
 */
export function EmailBodyEditor({
  value,
  onChange,
  fields,
  look,
  senderName,
}: {
  value: EmailNode;
  onChange: (value: EmailNode) => void;
  fields: readonly CustomField[];
  look: EmailLook;
  senderName: string;
}) {
  const toast = useToast();
  const imageInput = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [button, setButton] = useState<{ pos: number; text: string; href: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const editor = useEditor({
    extensions: bodyExtensions,
    content: value as JSONContent,
    editorProps: {
      attributes: {
        class: 'email-body min-h-[240px] text-[15px] leading-6 text-[#1f2933] outline-none',
        'aria-label': t.editor.bodyPlaceholder,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as EmailNode),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      link: e?.isActive('link') ?? false,
      bulletList: e?.isActive('bulletList') ?? false,
      orderedList: e?.isActive('orderedList') ?? false,
      block: e?.isActive('heading', { level: 2 })
        ? 'h2'
        : e?.isActive('heading', { level: 3 })
          ? 'h3'
          : 'p',
    }),
  });
  const context = useMemo<EmailEditorContextValue>(
    () => ({
      label: (name) => variableLabel(name, fields),
      accent: look.accent,
      editButton: (pos, attrs) => setButton({ pos, ...attrs }),
    }),
    [fields, look.accent],
  );

  const chain = () => editor?.chain().focus();
  const applyLink = () => {
    const href = linking?.trim() ?? '';
    setLinking(null);
    if (!/^(https?:\/\/|mailto:)./i.test(href) || href === 'https://') return;
    chain()?.extendMarkRange('link').setLink({ href }).run();
  };
  const insertImage = async (file: File) => {
    setUploading(true);
    try {
      const { key, width } = await uploadEmailImage(file);
      chain()
        ?.insertContent({ type: 'image', attrs: { src: key, width: Math.min(width, 536) } })
        .run();
    } catch (error) {
      toast(
        'error',
        error instanceof ImageNotAllowed ? t.editor.imageNotAllowed : t.editor.imageFailed,
      );
    } finally {
      setUploading(false);
    }
  };

  const dark = look.headerStyle === 'dark';
  return (
    <EmailEditorContext.Provider value={context}>
      <div
        role="toolbar"
        aria-label={t.editor.toolbar}
        className="sticky top-[72px] z-10 flex flex-wrap items-center gap-0.5 border-b border-border-subtle bg-surface px-3 py-2"
      >
        <Select
          aria-label={t.editor.blockType}
          className="h-8 w-36 text-[13px]"
          value={state?.block ?? 'p'}
          onChange={(block) => {
            if (block === 'p') chain()?.setParagraph().run();
            else
              chain()
                ?.setHeading({ level: block === 'h2' ? 2 : 3 })
                .run();
          }}
        >
          <SelectItem value="p">{t.editor.paragraph}</SelectItem>
          <SelectItem value="h2">{t.editor.heading2}</SelectItem>
          <SelectItem value="h3">{t.editor.heading3}</SelectItem>
        </Select>
        <Sep />
        <ToolButton
          label={t.editor.bold}
          active={state?.bold}
          onClick={() => chain()?.toggleBold().run()}
        >
          <Bold className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label={t.editor.italic}
          active={state?.italic}
          onClick={() => chain()?.toggleItalic().run()}
        >
          <Italic className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label={t.editor.link}
          active={state?.link}
          onClick={() =>
            editor?.isActive('link') ? chain()?.unsetLink().run() : setLinking('https://')
          }
        >
          <Link2 className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label={t.editor.bulletList}
          active={state?.bulletList}
          onClick={() => chain()?.toggleBulletList().run()}
        >
          <List className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label={t.editor.orderedList}
          active={state?.orderedList}
          onClick={() => chain()?.toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" aria-hidden />
        </ToolButton>
        <Sep />
        <ToolButton label={t.editor.image} onClick={() => imageInput.current?.click()}>
          <ImageIcon className="size-4" aria-hidden />
        </ToolButton>
        <input
          ref={imageInput}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void insertImage(file);
          }}
        />
        <ToolButton
          label={t.editor.button}
          wide
          onClick={() =>
            chain()
              ?.insertContent({
                type: 'button',
                attrs: { text: t.editor.buttonDefault, href: 'https://' },
              })
              .run()
          }
        >
          <MousePointerClick className="size-4" aria-hidden />
          {t.editor.button}
        </ToolButton>
        <ToolButton
          label={t.editor.callout}
          wide
          onClick={() =>
            chain()
              ?.insertContent({ type: 'callout', content: [{ type: 'paragraph' }] })
              .run()
          }
        >
          <SquareDashed className="size-4" aria-hidden />
          {t.editor.callout}
        </ToolButton>
        <ToolButton
          label={t.editor.columns}
          wide
          onClick={() =>
            chain()
              ?.insertContent({
                type: 'columns',
                content: [
                  { type: 'column', content: [{ type: 'paragraph' }] },
                  { type: 'column', content: [{ type: 'paragraph' }] },
                ],
              })
              .run()
          }
        >
          <Columns2 className="size-4" aria-hidden />
          {t.editor.columns}
        </ToolButton>
        <ToolButton label={t.editor.divider} onClick={() => chain()?.setHorizontalRule().run()}>
          <Minus className="size-4" aria-hidden />
        </ToolButton>
        <VariableMenu editor={editor} fields={fields} />
      </div>
      {linking !== null ? (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-surface px-3 pb-2">
          <input
            autoFocus
            aria-label={t.editor.linkPrompt}
            value={linking}
            onChange={(event) => setLinking(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') setLinking(null);
            }}
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 text-[13px] outline-none focus:border-primary"
          />
          <Button size="sm" variant="ghost" onClick={() => setLinking(null)}>
            {sk.common.cancel}
          </Button>
          <Button size="sm" onClick={applyLink}>
            {t.editor.linkApply}
          </Button>
        </div>
      ) : null}
      {uploading ? (
        <p
          role="status"
          className="border-b border-border-subtle bg-surface px-3 py-1.5 text-xs text-muted"
        >
          {t.editor.imageUploading}
        </p>
      ) : null}

      <div className="flex justify-center bg-[#e9eeee] px-4 pt-7 pb-9">
        <div
          className="w-full max-w-[600px] rounded-[14px] outline-2 outline-offset-[6px] outline-[rgba(15,139,141,0.35)] outline-dashed"
          style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
        >
          <div className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(12,59,60,0.06)]">
            <div
              className={cn(
                'flex items-center gap-3 px-8 py-[22px]',
                dark
                  ? 'bg-[linear-gradient(135deg,#104b4c,#0c3b3c)]'
                  : 'border-b border-[#e5eaea] bg-white',
              )}
            >
              {look.logoKey ? (
                <img src={`/m/${look.logoKey}`} alt="" className="h-9 w-auto rounded-lg" />
              ) : null}
              <span className={cn('text-xl font-bold', dark ? 'text-white' : 'text-[#0c3b3c]')}>
                {look.brandName}
              </span>
              <span className={cn('ml-auto text-xs', dark ? 'text-[#a9c9c7]' : 'text-[#616e7c]')}>
                {look.headerText}
              </span>
            </div>
            <div className="px-8 pt-8 pb-2">
              <EditorContent editor={editor} />
              <div className="mt-3 border-t border-[#e5eaea] pt-5 pb-6 text-[15px] leading-6">
                <p>{t.signature.greeting}</p>
                <p className="mt-3 font-bold">{senderName}</p>
                <p className="text-sm text-[#616e7c]">
                  {[v['sender.position'], look.brandName, v['sender.phone']].join(' · ')}
                </p>
              </div>
            </div>
            <div className="border-t border-[#e5eaea] bg-[#f7f9f9] px-8 py-5 text-xs leading-[18px] text-[#616e7c]">
              <p>
                {[
                  look.brandName,
                  look.footerCompany,
                  look.footerIco ? `IČO ${look.footerIco}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-0.5" style={{ color: look.accent }}>
                {[look.footerEmail, look.footerWeb].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-2.5">
                {t.footer.reason(v['customer.name'])}{' '}
                <span style={{ color: look.accent }}>{t.footer.unsubscribe}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {button ? (
        <ButtonDialog
          initial={button}
          onClose={() => setButton(null)}
          onRemove={() => {
            editor?.chain().focus().setNodeSelection(button.pos).deleteSelection().run();
            setButton(null);
          }}
          onSave={(attrs) => {
            editor
              ?.chain()
              .focus()
              .setNodeSelection(button.pos)
              .updateAttributes('button', attrs)
              .run();
            setButton(null);
          }}
        />
      ) : null}
    </EmailEditorContext.Provider>
  );
}

/** The subject: one line, variables as chips, a menu to insert them. */
export function EmailSubjectEditor({
  value,
  onChange,
  fields,
  labelledBy,
}: {
  value: EmailNode;
  onChange: (value: EmailNode) => void;
  fields: readonly CustomField[];
  labelledBy: string;
}) {
  const editor = useEditor({
    extensions: subjectExtensions,
    content: value as JSONContent,
    editorProps: {
      attributes: {
        class: 'min-h-6 text-[15px] leading-6 outline-none',
        role: 'textbox',
        'aria-labelledby': labelledBy,
      },
      // One line: Enter does nothing.
      handleKeyDown: (_view, event) => event.key === 'Enter',
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as EmailNode),
  });
  const context = useMemo<EmailEditorContextValue>(
    () => ({
      label: (name) => variableLabel(name, fields),
      accent: '#0f766e',
      editButton: () => undefined,
    }),
    [fields],
  );
  return (
    <EmailEditorContext.Provider value={context}>
      <div className="rounded-xl border border-border px-3.5 pt-2 pb-1.5 focus-within:border-primary">
        <div className="flex items-center justify-between gap-2">
          <span id={labelledBy} className="text-xs font-medium text-muted">
            {t.fields.subject}
          </span>
          <VariableMenu editor={editor} fields={fields} compact />
        </div>
        <EditorContent editor={editor} />
      </div>
    </EmailEditorContext.Provider>
  );
}
