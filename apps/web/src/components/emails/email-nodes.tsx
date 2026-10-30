import { sk } from '@intra/shared/i18n';
import {
  Mark,
  mergeAttributes,
  Node,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react';
import { createContext, useContext } from 'react';
import { cn } from '@/lib/utils';

const t = sk.templates;

/** A button's attributes: an address, or the product whose interest it records. */
export interface ButtonAttrs {
  text: string;
  href: string;
  interestProductId: string | null;
  /** `center` in the middle of the e-mail; otherwise at the left. */
  align: string | null;
}

/** What the node views need from the editor around them: names of variables, the accent. */
export interface EmailEditorContextValue {
  /** The label of a variable (`custom.nurses` → „Počet sestier“). */
  label: (name: string) => string;
  accent: string;
  /** The look's logo, for the logo within a line. */
  logoKey: string | null;
  /** Opens the button dialog for the button at this position. */
  editButton: (pos: number, attrs: ButtonAttrs) => void;
}

export const EmailEditorContext = createContext<EmailEditorContextValue>({
  label: (name) => name,
  accent: '#0f766e',
  logoKey: null,
  editButton: () => undefined,
});

/** A variable as a chip; the value is filled per recipient when sending. */
function VariableChip({ node, selected }: NodeViewProps) {
  const { label } = useContext(EmailEditorContext);
  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        'mx-px inline-flex h-[22px] items-center rounded-md bg-primary-soft px-2 align-[1px] text-[13px] font-semibold whitespace-nowrap text-primary-text shadow-[inset_0_0_0_1px_#bfe2df]',
        selected && 'outline-2 outline-primary',
      )}
      data-variable={String(node.attrs.name)}
    >
      {label(String(node.attrs.name))}
    </NodeViewWrapper>
  );
}

export const Variable = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-variable]',
        getAttrs: (el) => ({ name: el.getAttribute('data-variable') }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-variable': node.attrs.name as string }),
      String(node.attrs.name),
    ];
  },
  renderText({ node }) {
    return `{${String(node.attrs.name)}}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(VariableChip);
  },
});

/** „Farba značky“: text in the look's accent, which the editor's frame sets as a CSS variable. */
export const Accent = Mark.create({
  name: 'accent',
  parseHTML() {
    return [{ tag: 'span[data-accent]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-accent': '',
        style: 'color: var(--email-accent)',
      }),
      0,
    ];
  },
});

/**
 * A logo at the height of the text: its own picture, or the look's; without either, a chip, as the
 * e-mail shows nothing.
 */
function LogoView({ node, selected }: NodeViewProps) {
  const { logoKey: lookLogo } = useContext(EmailEditorContext);
  const logoKey = (node.attrs.src as string | null) ?? lookLogo;
  return (
    <NodeViewWrapper as="span" data-logo="" className={cn(selected && 'outline-2 outline-primary')}>
      {logoKey ? (
        <img
          src={`/m/${logoKey}`}
          alt={t.editor.logo}
          className="mr-1 inline-block h-[18px] w-auto rounded-[5px] align-[-3px]"
        />
      ) : (
        <span className="mx-px inline-flex h-[22px] items-center rounded-md bg-hover px-2 align-[1px] text-[13px] font-semibold whitespace-nowrap text-muted">
          {t.editor.logo}
        </span>
      )}
    </NodeViewWrapper>
  );
}

export const Logo = Node.create({
  name: 'logo',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'span[data-logo]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-logo': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(LogoView);
  },
});

/** A call to action: shown as the e-mail will show it; a click edits its text and address. */
function ButtonView({ node, getPos, selected }: NodeViewProps) {
  const { accent, editButton } = useContext(EmailEditorContext);
  const attrs: ButtonAttrs = {
    text: String(node.attrs.text ?? ''),
    href: String(node.attrs.href ?? ''),
    interestProductId: (node.attrs.interestProductId as string | null) ?? null,
    align: (node.attrs.align as string | null) ?? null,
  };
  return (
    <NodeViewWrapper
      className={cn('my-2 mb-6', attrs.align === 'center' && 'text-center')}
      data-drag-handle
    >
      <button
        type="button"
        contentEditable={false}
        onClick={() => {
          const pos = getPos();
          if (typeof pos === 'number') editButton(pos, attrs);
        }}
        className={cn(
          'inline-block rounded-[10px] px-5 py-3 text-[15px] font-bold text-white',
          selected && 'outline-2 outline-offset-2 outline-primary',
        )}
        style={{ backgroundColor: accent }}
        title={attrs.interestProductId ? t.editor.buttonInterest : attrs.href}
      >
        {attrs.text || t.editor.buttonDefault}
      </button>
    </NodeViewWrapper>
  );
}

export const EmailButton = Node.create({
  name: 'button',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      text: { default: t.editor.buttonDefault },
      href: { default: 'https://' },
      interestProductId: { default: null },
      align: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-button]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-button': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ButtonView);
  },
});

/** „Zvýraznený blok“: text on the accent's softest tint, like the price box of an offer. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        class: 'my-4 rounded-[10px] bg-[#f0f8f7] px-[18px] pt-4 pb-0.5',
      }),
      0,
    ];
  },
});

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-column': '',
        class:
          'min-w-0 rounded-md outline-1 outline-dashed outline-transparent hover:outline-border',
      }),
      0,
    ];
  },
});

/** „Dva stĺpce“: two columns side by side, each its own blocks; one under the other on a phone. */
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column column',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-columns': '', class: 'mb-2 grid grid-cols-2 gap-6' }),
      0,
    ];
  },
});

/** A picture from the e-mail image store, served at `/m/<key>` to everybody. */
export const EmailImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, width: { default: null }, alt: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'img[data-key]', getAttrs: (el) => ({ src: el.dataset.key }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const width = Math.min(Number(node.attrs.width) || 536, 536);
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-key': node.attrs.src as string,
        src: `/m/${String(node.attrs.src)}`,
        alt: String(node.attrs.alt ?? ''),
        width,
        class: 'mb-4 block h-auto max-w-full rounded-lg',
      }),
    ];
  },
});
