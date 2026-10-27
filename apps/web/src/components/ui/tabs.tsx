import { Link, type RegisteredRouter, type ValidateLinkOptions } from '@tanstack/react-router';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * The tabs of a detail screen: 44 high, 13 px in text/secondary, the chosen
 * one in accent/text medium with a 2 px underline that slides to it in 180 ms; a count sits in a
 * small pill (accent/soft on the chosen tab). The bar stays under the sticky header, with its
 * bottom line. Every tab is a link: the chosen one is the current route or the `tab` search.
 *
 * A `TabBar` rendered by several routes (Vykazovanie) remounts per route, so its line does not
 * slide there; on a layout that stays (the patient card, the agency) it does.
 *
 * ```tsx
 * <TabBar label={t.tabs.label}>
 *   <TabLink to="/patients/$patientId" params={{ patientId }} active={tab === 'overview'}>
 *     {t.tabs.overview}
 *   </TabLink>
 * </TabBar>
 * ```
 */
export function TabBar({
  label,
  children,
  className,
  sticky = true,
}: {
  label: string;
  children: ReactNode;
  className?: string | undefined;
  /** Under the page header; `false` inside a card. */
  sticky?: boolean;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [underline, setUnderline] = useState<{ left: number; width: number } | null>(null);
  // The underline follows the chosen tab: measured after every render, cheap enough for a row of
  // four, and it is what makes the line slide instead of jump. Measured again once the font has
  // arrived and whenever the bar changes size, since both move the tabs.
  const measure = () => {
    const active = bar.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!active) {
      setUnderline(null);
      return;
    }
    const next = underlineOf(active);
    setUnderline((prev) =>
      prev && prev.left === next.left && prev.width === next.width ? prev : next,
    );
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    void document.fonts?.ready.then(measure);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // The arrow keys walk the tabs, as a tablist is expected to; Home and End jump to the ends.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...(bar.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || tabs.length === 0) return;
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    event.preventDefault();
    tabs[to]?.focus();
  };
  return (
    <div
      ref={bar}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'scrollbar-none relative flex h-11 items-stretch gap-6 overflow-x-auto border-b border-border whitespace-nowrap',
        sticky && 'sticky top-[72px] z-20 bg-white',
        className,
      )}
    >
      {children}
      {underline ? (
        <span aria-hidden className={underlineClass} style={underlineStyle(underline)} />
      ) : null}
    </div>
  );
}

/**
 * Where the line goes: the chosen tab's `offsetLeft` and width. `offsetLeft` is measured from the
 * bar's padding edge (the bar is `relative`, so it is the tab's offset parent), padding included.
 */
export const underlineOf = (tab: Pick<HTMLElement, 'offsetLeft' | 'offsetWidth'>) => ({
  left: tab.offsetLeft,
  width: tab.offsetWidth,
});

/**
 * `left-0` anchors the line at that same padding edge. Without it an absolute box in a flex row
 * starts where the content starts, after the bar's padding, and a bar given `px-7` (the agency's
 * detail) drew the line 28 px right of its tab: the padding counted twice.
 */
export const underlineClass =
  'absolute bottom-0 left-0 h-0.5 rounded-t-sm bg-primary transition-[transform,width] duration-[180ms] ease-out-soft motion-reduce:transition-none';

export const underlineStyle = ({ left, width }: { left: number; width: number }) => ({
  width,
  transform: `translateX(${left}px)`,
});

export function TabLink<TRouter extends RegisteredRouter, TOptions>(
  props: ValidateLinkOptions<TRouter, TOptions> & {
    active: boolean;
    count?: ReactNode;
    children: ReactNode;
    'aria-controls'?: string;
  },
): ReactNode;
export function TabLink({
  active,
  count,
  children,
  ...link
}: ValidateLinkOptions & {
  active: boolean;
  /** A count or a short word in the pill after the label („7 čaká“, „august“). */
  count?: ReactNode;
  children: ReactNode;
  'aria-controls'?: string;
}) {
  return (
    <Link
      {...link}
      role="tab"
      aria-selected={active}
      className={cn(
        // The row scrolls sideways, which clips anything drawn outside a tab: the keyboard ring
        // goes inside.
        'inline-flex items-center gap-2 rounded-sm px-1 text-[13px] transition-colors duration-150 focus-visible:-outline-offset-2',
        active ? 'font-medium text-primary-text' : 'text-muted hover:text-foreground',
      )}
    >
      {children}
      {count !== undefined && count !== null ? (
        <span
          className={cn(
            'inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium',
            active ? 'bg-primary-soft text-primary-text' : 'bg-surface text-muted',
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
