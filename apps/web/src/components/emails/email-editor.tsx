import { sk } from '@intra/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import {
  ACTIVITY_TYPE_INTEREST_ID,
  brandParts,
  type CustomField,
  type EmailLook,
  type EmailNode,
  alignOf,
  filledLookLines,
  LOOK_ALIGNS,
  type LookAlign,
  lookValuesOf,
  SYSTEM_VARIABLES,
  variablesOf,
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
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
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
  Palette,
  SquareDashed,
  Stamp,
  Tag,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useMemo, useRef, useState } from 'react';
import {
  Accent,
  Callout,
  Column,
  Columns,
  EmailButton,
  EmailEditorContext,
  type ButtonAttrs,
  type EmailEditorContextValue,
  EmailImage,
  Logo,
  ParagraphAlign,
  Variable,
} from '@/components/emails/email-nodes';
import { FilePicker } from '@/components/files/file-picker';
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
import { trpc, trpcClient } from '@/lib/trpc';
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
  Accent,
  Logo,
  ParagraphAlign,
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

const lookGroup = {
  label: v.groups.look,
  names: ['brand.name', 'company.name', 'company.ico', 'company.web', 'company.email'],
};
const recipientGroup = { label: v.groups.recipient, names: ['customer.name'] };
/** What a signature may say: the sender, the company and whom it is written to. */
export const SIGNATURE_VARIABLES = [
  {
    label: v.groups.sender,
    names: ['sender.name', 'sender.position', 'sender.phone', 'sender.email', 'sender.signature'],
  },
  lookGroup,
  recipientGroup,
];
/** What a footer may say: the link to unsubscribe first, as it must stay in it. */
export const FOOTER_VARIABLES = [
  { label: v.groups.required, names: ['unsubscribe'] },
  lookGroup,
  recipientGroup,
];

/** „Vložiť premennú“: the variables by group, inserted as chips where the cursor is. */
function VariableMenu({
  editor,
  fields,
  groups = variableGroups(fields),
  compact = false,
}: {
  editor: Editor | null;
  fields: readonly CustomField[];
  groups?: readonly { label: string; names: readonly string[] }[];
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
        {groups.map((group, i) => (
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

/**
 * „Vložiť názov produktu“: the look's logo and its brand in bold, the words after the first in its
 * colour, joined so the name never breaks. The space after it lets the text go on without the marks.
 */
function productNameNodes(look: EmailLook): JSONContent[] {
  const { first, rest } = brandParts(look);
  const bold = { type: 'bold' };
  return [
    { type: 'logo' },
    { type: 'text', text: rest ? `${first}\u00a0` : first, marks: [bold] },
    ...(rest
      ? [
          {
            type: 'text',
            text: rest.replaceAll(' ', '\u00a0'),
            marks: [bold, { type: 'accent' }],
          },
        ]
      : []),
    { type: 'text', text: ' ' },
  ];
}

/** A tool with a choice of where its picture comes from. */
function ToolMenu({
  label,
  icon,
  items,
}: {
  label: string;
  icon: ReactNode;
  items: { label: string; onSelect: () => void }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onMouseDown={(event) => event.preventDefault()}
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-foreground"
        >
          {icon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px bg-border" />;

/** The text box under the toolbar where a link's address or a button's is typed. */
function ButtonDialog({
  initial,
  defaultProductId,
  onClose,
  onSave,
  onRemove,
}: {
  initial: ButtonAttrs;
  /** The product a button that records interest starts on: the look's. */
  defaultProductId: string | null;
  onClose: () => void;
  onSave: (attrs: ButtonAttrs) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(initial.text);
  const [href, setHref] = useState(initial.href);
  const wasRecording = initial.activityTypeId !== null || initial.interestProductId !== null;
  const [records, setRecords] = useState(wasRecording);
  const [typeId, setTypeId] = useState(
    initial.activityTypeId ?? (wasRecording ? ACTIVITY_TYPE_INTEREST_ID : ''),
  );
  const [productId, setProductId] = useState(
    initial.productId ?? initial.interestProductId ?? defaultProductId ?? '',
  );
  const [centered, setCentered] = useState(initial.align === 'center');
  const products = useQuery({ ...trpc.product.list.queryOptions(), enabled: records });
  const types = useQuery({ ...trpc.activityType.list.queryOptions(), enabled: records });
  // A type switched off is not offered for a new button, one already holding it keeps it.
  const offered = (types.data ?? []).filter(
    (item) => item.confirmLabel !== null && (item.active || item.id === initial.activityTypeId),
  );
  const chosenType = offered.find((item) => item.id === typeId) ?? offered[0] ?? null;
  const chosen = chosenType?.asksProduct ? productId || products.data?.[0]?.id || '' : '';
  const valid =
    text.trim() !== '' &&
    (records
      ? chosenType !== null && (!chosenType.asksProduct || chosen !== '')
      : /^(https?:\/\/|mailto:)./i.test(href.trim()));
  const option = (on: boolean) =>
    cn(
      'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm',
      on ? 'border-primary bg-[#f0f8f7]' : 'border-border',
    );
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
            if (!valid) return;
            const align = centered ? 'center' : null;
            onSave(
              records
                ? {
                    text: text.trim(),
                    href: '',
                    activityTypeId: chosenType?.id ?? null,
                    productId: chosen || null,
                    interestProductId: null,
                    align,
                  }
                : {
                    text: text.trim(),
                    href: href.trim(),
                    activityTypeId: null,
                    productId: null,
                    interestProductId: null,
                    align,
                  },
            );
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
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t.editor.buttonAction}</legend>
            <label className={option(!records)}>
              <input
                type="radio"
                name="button-action"
                checked={!records}
                onChange={() => setRecords(false)}
                className="mt-0.5 accent-[#0f766e]"
              />
              <span>
                {t.editor.buttonLink}
                <span className="block text-xs text-muted">{t.editor.buttonLinkHint}</span>
              </span>
            </label>
            <label className={option(records)}>
              <input
                type="radio"
                name="button-action"
                checked={records}
                onChange={() => setRecords(true)}
                className="mt-0.5 accent-[#0f766e]"
              />
              <span>
                {t.editor.buttonInterest}
                <span className="block text-xs text-muted">{t.editor.buttonInterestHint}</span>
              </span>
            </label>
          </fieldset>
          {records ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="button-type">{t.editor.buttonType}</Label>
                <Select id="button-type" value={chosenType?.id ?? ''} onChange={setTypeId}>
                  {offered.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              {chosenType?.asksProduct ? (
                <div className="space-y-2">
                  <Label htmlFor="button-product">{t.editor.buttonProduct}</Label>
                  <Select id="button-product" value={chosen} onChange={setProductId}>
                    {(products.data ?? []).map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
              ) : null}
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="button-href">{t.editor.buttonHref}</Label>
              <Input
                id="button-href"
                maxLength={2000}
                value={href}
                onChange={(e) => setHref(e.target.value)}
              />
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={centered}
              onChange={(event) => setCentered(event.target.checked)}
              className="accent-[#0f766e]"
            />
            {t.editor.buttonCenter}
          </label>
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
  signature = true,
  unsubscribe = true,
  defaultProductId = null,
}: {
  value: EmailNode;
  onChange: (value: EmailNode) => void;
  fields: readonly CustomField[];
  look: EmailLook;
  senderName: string;
  /** The product of the look, where a button that records interest starts. */
  defaultProductId?: string | null;
  /** Off when the signature is part of the text itself, as in an answer. */
  signature?: boolean;
  /** Off for correspondence, which goes without an unsubscribe link (D-14). */
  unsubscribe?: boolean;
}) {
  const toast = useToast();
  const imageInput = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [button, setButton] = useState<({ pos: number } & ButtonAttrs) | null>(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState<'image' | 'logo' | null>(null);
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
      justify: e?.isActive('paragraph', { align: 'justify' }) ?? false,
      accent: e?.isActive('accent') ?? false,
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
      logoKey: look.logoKey,
      editButton: (pos, attrs) => setButton({ pos, ...attrs }),
    }),
    [fields, look.accent, look.logoKey],
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
  const insertFromFiles = async (fileId: string, as: 'image' | 'logo') => {
    setUploading(true);
    try {
      const { key, width } = await trpcClient.template.imageFromFile.mutate({ fileId });
      chain()
        ?.insertContent(
          as === 'logo'
            ? { type: 'logo', attrs: { src: key } }
            : { type: 'image', attrs: { src: key, width: Math.min(width, 536) } },
        )
        .run();
    } catch {
      toast('error', t.editor.fromFilesFailed);
    } finally {
      setUploading(false);
    }
  };

  const dark = look.headerStyle === 'dark';
  const brand = brandParts(look);
  return (
    <EmailEditorContext.Provider value={context}>
      <div
        role="toolbar"
        aria-label={t.editor.toolbar}
        className="sticky top-[var(--page-header-height,72px)] z-10 flex flex-wrap items-center gap-0.5 border-b border-border-subtle bg-surface px-3 py-2"
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
          label={t.editor.justify}
          active={state?.justify}
          onClick={() =>
            chain()
              ?.updateAttributes('paragraph', { align: state?.justify ? null : 'justify' })
              .run()
          }
        >
          <AlignJustify className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label={t.editor.accent}
          active={state?.accent}
          onClick={() => chain()?.toggleMark('accent').run()}
        >
          <Palette className="size-4" aria-hidden />
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
        <ToolMenu
          label={t.editor.image}
          icon={<ImageIcon className="size-4" aria-hidden />}
          items={[
            { label: t.editor.fromComputer, onSelect: () => imageInput.current?.click() },
            { label: t.editor.fromFiles, onSelect: () => setPicking('image') },
          ]}
        />
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
        <ToolMenu
          label={t.editor.logo}
          icon={<Stamp className="size-4" aria-hidden />}
          items={[
            {
              label: t.editor.logoOfLook,
              onSelect: () => chain()?.insertContent({ type: 'logo' }).run(),
            },
            { label: t.editor.fromFiles, onSelect: () => setPicking('logo') },
          ]}
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
        <div className="ml-auto flex items-center gap-0.5">
          <ToolButton
            label={t.editor.productName}
            wide
            onClick={() => chain()?.insertContent(productNameNodes(look)).run()}
          >
            <Tag className="size-4" aria-hidden />
            {t.editor.productName}
          </ToolButton>
          <VariableMenu editor={editor} fields={fields} compact />
        </div>
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
          style={
            {
              fontFamily: 'Helvetica, Arial, sans-serif',
              '--email-accent': look.accent,
            } as CSSProperties
          }
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
                {brand.first}
                {brand.rest ? <span style={{ color: brand.restColor }}> {brand.rest}</span> : null}
              </span>
              <span
                className={cn('min-w-0 flex-1 text-xs', dark ? 'text-[#a9c9c7]' : 'text-[#616e7c]')}
              >
                <HeaderLines doc={look.headerDoc} />
              </span>
            </div>
            <div className="px-8 pt-8 pb-2">
              <EditorContent editor={editor} />
              {signature ? (
                <div className="mt-3 border-t border-[#e5eaea] pt-5 pb-6 text-[15px] leading-6">
                  <LookLines
                    doc={look.signatureDoc}
                    look={look}
                    senderName={senderName}
                    unsubscribe={false}
                  />
                </div>
              ) : null}
            </div>
            <div className="border-t border-[#e5eaea] bg-[#f7f9f9] px-8 py-5 text-xs leading-[18px] text-[#616e7c]">
              <LookLines
                doc={look.footerDoc}
                look={look}
                senderName={senderName}
                unsubscribe={unsubscribe}
                standard="center"
              />
            </div>
          </div>
        </div>
      </div>

      {picking ? (
        <FilePicker
          lead={t.editor.fromFilesLead}
          notes={[t.editor.fromFilesNote]}
          already={new Set()}
          imagePick={t.editor.fromFilesPick}
          onClose={() => setPicking(null)}
          onPick={([file]) => {
            if (file) void insertFromFiles(file.fileId, picking);
          }}
        />
      ) : null}

      {button ? (
        <ButtonDialog
          initial={button}
          defaultProductId={defaultProductId}
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

/** The header's own text: lines, bold and italic, and nothing else the e-mail would not show. */
const headerExtensions = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: false,
    trailingNode: false,
  }),
  ParagraphAlign,
];

const lookDocExtensions = [...headerExtensions, Variable];

/** Left, centre or right for the lines the cursor is on; a line unset keeps the field's standard. */
function AlignButtons({ editor, standard }: { editor: Editor | null; standard: LookAlign }) {
  const current = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      (e?.getAttributes('paragraph').align as LookAlign | null | undefined) ?? standard,
  });
  const icons = { left: AlignLeft, center: AlignCenter, right: AlignRight };
  return (
    <>
      {LOOK_ALIGNS.map((align) => {
        const Icon = icons[align];
        return (
          <ToolButton
            key={align}
            label={t.editor.aligns[align]}
            active={current === align}
            onClick={() => editor?.chain().focus().updateAttributes('paragraph', { align }).run()}
          >
            <Icon className="size-4" aria-hidden />
          </ToolButton>
        );
      })}
    </>
  );
}

export function EmailHeaderEditor({
  value,
  onChange,
  labelledBy,
  disabled = false,
}: {
  value: EmailNode | null;
  onChange: (value: EmailNode) => void;
  labelledBy: string;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: headerExtensions,
    editable: !disabled,
    content: (value ?? { type: 'doc', content: [{ type: 'paragraph' }] }) as JSONContent,
    editorProps: {
      attributes: {
        class: 'min-h-12 px-3.5 py-2 text-sm leading-5 outline-none',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelledBy,
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as EmailNode),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
    }),
  });
  return (
    <div className="rounded-xl border border-border focus-within:border-primary">
      {disabled ? null : (
        <div className="flex gap-0.5 border-b border-border-subtle px-1.5 py-1">
          <ToolButton
            label={t.editor.bold}
            active={state?.bold}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="size-4" aria-hidden />
          </ToolButton>
          <ToolButton
            label={t.editor.italic}
            active={state?.italic}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-4" aria-hidden />
          </ToolButton>
          <AlignButtons editor={editor} standard="left" />
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * A signature or a footer of a look: lines of text and variables, bold or italic, with a menu of the
 * variables it may use.
 */
export function EmailLookDocEditor({
  value,
  onChange,
  labelledBy,
  groups,
  standard = 'left',
  disabled = false,
}: {
  value: EmailNode;
  onChange: (value: EmailNode) => void;
  labelledBy: string;
  groups: readonly { label: string; names: readonly string[] }[];
  /** How a line with no alignment of its own goes: the footer's are in the centre. */
  standard?: LookAlign;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: lookDocExtensions,
    editable: !disabled,
    content: value as JSONContent,
    editorProps: {
      attributes: {
        class: cn(
          'min-h-16 px-3.5 py-2 text-sm leading-6 outline-none',
          standard === 'center' && 'text-center',
        ),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelledBy,
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as EmailNode),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
    }),
  });
  const context = useMemo<EmailEditorContextValue>(
    () => ({
      label: (name) => variableLabel(name, []),
      accent: '#0f766e',
      logoKey: null,
      editButton: () => undefined,
    }),
    [],
  );
  return (
    <EmailEditorContext.Provider value={context}>
      <div className="rounded-xl border border-border focus-within:border-primary">
        {disabled ? null : (
          <div className="flex items-center gap-0.5 border-b border-border-subtle px-1.5 py-1">
            <ToolButton
              label={t.editor.bold}
              active={state?.bold}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            >
              <Bold className="size-4" aria-hidden />
            </ToolButton>
            <ToolButton
              label={t.editor.italic}
              active={state?.italic}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-4" aria-hidden />
            </ToolButton>
            <AlignButtons editor={editor} standard={standard} />
            <VariableMenu editor={editor} fields={[]} groups={groups} />
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </EmailEditorContext.Provider>
  );
}

/** A signature or a footer as it shows in the frame around the body: filled as far as known. */
function LookLines({
  doc,
  look,
  senderName,
  unsubscribe,
  standard = 'left',
}: {
  doc: EmailNode;
  look: EmailLook;
  senderName: string;
  unsubscribe: boolean;
  standard?: LookAlign;
}) {
  const labels = Object.fromEntries(
    variablesOf(doc).map((name) => [name, variableLabel(name, [])]),
  );
  const values = {
    ...labels,
    ...lookValuesOf(look, labels, { unsubscribeUrl: unsubscribe ? '#' : undefined }),
    'sender.name': senderName,
    ...(unsubscribe ? {} : { 'customer.name': undefined }),
  };
  return (
    <>
      {filledLookLines(doc, values, t.footer.unsubscribe).map((line, i) => (
        <p key={i} style={{ textAlign: alignOf(line, standard) }}>
          {line.content?.length
            ? line.content.map((node, j) => {
                if (node.type === 'hardBreak') return <br key={j} />;
                let out: ReactNode = node.text;
                if (node.marks?.some((m) => m.type === 'link')) {
                  out = <span style={{ color: look.accent }}>{out}</span>;
                }
                if (node.marks?.some((m) => m.type === 'italic')) out = <em>{out}</em>;
                if (node.marks?.some((m) => m.type === 'bold')) out = <strong>{out}</strong>;
                return <span key={j}>{out}</span>;
              })
            : ' '}
        </p>
      ))}
    </>
  );
}

/** The header's text as it shows in the e-mail's layout. */
function HeaderLines({ doc }: { doc: EmailNode | null }) {
  return (
    <>
      {(doc?.content ?? []).map((line, i) => (
        <div key={i} style={{ textAlign: alignOf(line, 'left') }}>
          {line.content?.length
            ? line.content.map((node, j) => {
                if (node.type === 'hardBreak') return <br key={j} />;
                let out: ReactNode = node.text;
                if (node.marks?.some((m) => m.type === 'italic')) out = <em>{out}</em>;
                if (node.marks?.some((m) => m.type === 'bold')) out = <strong>{out}</strong>;
                return <span key={j}>{out}</span>;
              })
            : '\u00a0'}
        </div>
      ))}
    </>
  );
}

/** The subject: one line, variables as chips, a menu to insert them. */
export function EmailSubjectEditor({
  value,
  onChange,
  fields,
  labelledBy,
  label = t.fields.subject,
}: {
  value: EmailNode;
  onChange: (value: EmailNode) => void;
  fields: readonly CustomField[];
  labelledBy: string;
  /** What the line is, when it is not the subject: the sender's name has the same form. */
  label?: string;
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
      logoKey: null,
      editButton: () => undefined,
    }),
    [fields],
  );
  return (
    <EmailEditorContext.Provider value={context}>
      <div className="rounded-xl border border-border px-3.5 pt-2 pb-1.5 focus-within:border-primary">
        <div className="flex items-center justify-between gap-2">
          <span id={labelledBy} className="text-xs font-medium text-muted">
            {label}
          </span>
          <VariableMenu editor={editor} fields={fields} compact />
        </div>
        <EditorContent editor={editor} />
      </div>
    </EmailEditorContext.Provider>
  );
}
