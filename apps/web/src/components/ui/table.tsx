import { useRouter } from '@tanstack/react-router';
import type {
  AnchorHTMLAttributes,
  HTMLAttributes,
  MouseEvent,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * The table of the web: rows 52 high (44 compact), 12/16 padding, the header
 * on bg/subtle in the overline style (not sticky: the frame scrolls sideways, and a sticky row
 * inside an overflow box has nothing to stick to), subtle dividers and none after the last row. A row
 * given `href` is a link to its detail as a whole (`TableRow`). Numbers and dates stand in
 * `tabular-nums` (styles.css) and go to the right with `align="right"` on their cells.
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full text-left text-sm', className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'bg-subtle text-[11px] font-semibold tracking-[0.05em] text-tertiary uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

/**
 * What a click on a clickable row does. A click that lands on something of its
 * own inside the row (a link, a button, a checkbox, a menu) is that thing's, never the row's; a
 * click that ends a text selection selects. Cmd/Ctrl/Shift or the middle button open a new tab, as
 * on a link; a plain left click opens the detail here.
 */
export type RowClickIntent = 'ignore' | 'newTab' | 'navigate';

export function rowClickIntent(click: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** The click started on an interactive element inside the row. */
  fromInteractive: boolean;
  /** Text is selected (the user dragged across a cell). */
  selecting: boolean;
}): RowClickIntent {
  if (click.fromInteractive || click.selecting) return 'ignore';
  if (click.button === 1 || click.metaKey || click.ctrlKey || click.shiftKey) return 'newTab';
  return click.button === 0 ? 'navigate' : 'ignore';
}

/** Elements inside a row that do something of their own: the row's click leaves them alone. */
export const ROW_INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="checkbox"], [role="menuitem"], [role="switch"], [data-row-ignore]';

/** The parts of a DOM element the row's click looks at. */
interface NodeLike {
  closest?: (selector: string) => NodeLike | null;
}

/**
 * The intent of a click as the row's handler receives it. A click that did not happen inside the
 * row's own DOM is ignored: React bubbles a click inside a portal (a menu, a dialog or its
 * „Zmazať“ opened from the row) through the row, though it is not in it (review of #405).
 */
export function intentOfClick(
  event: {
    target: unknown;
    currentTarget: { contains: (node: never) => boolean };
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
  },
  selecting: boolean,
): RowClickIntent {
  const target = event.target as NodeLike | null;
  if (!target || !event.currentTarget.contains(target as never)) return 'ignore';
  const control = target.closest?.(ROW_INTERACTIVE) ?? null;
  return rowClickIntent({
    button: event.button,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    fromInteractive: control !== null && event.currentTarget.contains(control as never),
    selecting,
  });
}

function intentOf(event: MouseEvent<HTMLElement>): RowClickIntent {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  return intentOfClick(
    event,
    Boolean(selection && !selection.isCollapsed && selection.toString().trim()),
  );
}

function openInNewTab(href: string) {
  window.open(href, '_blank', 'noopener');
}

/**
 * A table row. With `href` the whole row is a link to the detail: hover tint
 * and pointer, a plain click opens it, Cmd/Ctrl/Shift or the middle button a new tab, and inner
 * buttons and checkboxes keep their own clicks. For the keyboard and for „Otvoriť v novej karte“
 * the row's first cell holds the same address as a real link (`RowLink`). A row given only
 * `onClick` (no address to open) keeps the tint and the click, with the same care for inner controls.
 */
export function TableRow({
  className,
  onClick,
  href,
  onOpen,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & {
  href?: string | undefined;
  /** A plain click's own way to the detail (to carry router state); a new tab still uses `href`. */
  onOpen?: (() => void) | undefined;
}) {
  const router = useRouter({ warn: false });
  const clickable = Boolean(href || onClick);
  return (
    <tr
      className={cn(
        'group/row border-t border-border-subtle transition-colors duration-150',
        clickable && 'cursor-pointer hover:bg-primary-soft/60',
        className,
      )}
      onClick={
        href
          ? (event) => {
              const intent = intentOf(event);
              if (intent === 'newTab') openInNewTab(href);
              else if (intent === 'navigate') {
                if (onOpen) onOpen();
                else void router.navigate({ href });
              }
            }
          : onClick
            ? (event) => {
                // As with `href`: inner controls, menus and selected text keep their own clicks.
                if (intentOf(event) === 'navigate') onClick(event);
              }
            : undefined
      }
      onAuxClick={
        href
          ? (event) => {
              if (event.button === 1 && intentOf(event) === 'newTab') {
                event.preventDefault();
                openInNewTab(href);
              }
            }
          : undefined
      }
      {...props}
    />
  );
}

/**
 * A row's action icons: shown only while the pointer is on the row (`TableRow`, or a plain `tr`
 * with `group/row`). Keyboard focus, an open menu and a screen without a pointer keep them visible.
 */
export function RowActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex justify-end gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 has-focus-visible:opacity-100 has-data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The real link of a clickable row, around the row's name in its first cell: Tab reaches it,
 * Enter opens the detail, right click offers a new tab. A plain click stays in the app.
 */
/**
 * A link in a row that goes somewhere else than the row itself (the contact of a prevádzka, the
 * folder of a file): a small framed button, darker under the pointer, never underlined. A click on
 * it wins over the row's.
 */
export const CELL_LINK =
  'inline-flex max-w-full items-center rounded-lg border border-primary/25 bg-primary-soft px-2 py-0.5 text-[13px] font-semibold text-primary-text no-underline transition-colors hover:bg-[#d6ebe9]';

export function RowLink({
  href,
  className,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const router = useRouter({ warn: false });
  return (
    <a
      href={href}
      className={cn('rounded-sm text-inherit no-underline', className)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        void router.navigate({ href });
      }}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('h-11 px-4 py-3 font-semibold first:pl-5', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('h-13 px-4 py-3 first:pl-5', className)} {...props} />;
}
