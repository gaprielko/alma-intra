import { sk } from '@intra/shared/i18n';
import { createContext, useContext, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * What a screen shows before its data arrives (ALMA-205): the shape of the content in grey, never
 * the empty state („Žiadne …“), which belongs to a load that succeeded with nothing in it. Which
 * of the two to draw is `queryView` (lib/query-view.ts). The pieces:
 *
 * - `LoadingRegion` is the frame every skeleton sits in: `aria-busy` and one „Načítavam…“ for a
 *   screen reader, the grey shapes themselves are hidden from it. Skeletons put together into a
 *   bigger one (a page of tiles and tables) say it once: a nested region stays quiet. Parts of a
 *   screen that load on their own (the week grid and its two panels) sit in one region with
 *   `active` (true while any of them loads), so the screen says it once too (ALMA-206).
 * - `FieldSkeleton` stands in for a select whose chosen value needs a list that is still loading,
 *   `FormSkeleton` for a whole form whose values are still loading.
 * - `TableSkeleton` stands in for a table outside `TableShell` (which draws its own skeleton rows
 *   with `loading`); `ListSkeleton` for a list of lines (a dropdown, a dialog's list, a history);
 *   `CardSkeleton` for a card of text; `TilesSkeleton` for a row of KPI tiles; `PageSkeleton` for a
 *   whole screen whose header waits for the data too (a detail page).
 * - `Refreshing` keeps the previous data on screen, dimmed, while a filter, page or month loads
 *   (`placeholderData: keepPreviousData`), instead of a flash of skeleton or nothing.
 */

/** Inside a region that already says „Načítavam…“, a nested skeleton stays quiet. */
const InsideLoading = createContext(false);

export function LoadingRegion({
  children,
  className,
  as: Tag = 'div',
  active = true,
}: {
  children: ReactNode;
  className?: string | undefined;
  /** `li` inside a list, `span` inside a paragraph or a button. */
  as?: 'div' | 'li' | 'span' | 'section';
  /**
   * For a region around content that is partly loaded: whether anything in it is still loading.
   * While it is, the skeletons inside stay quiet and the region speaks for them; once nothing is,
   * it is a plain frame. Leave it out around a skeleton, which is always loading.
   */
  active?: boolean;
}) {
  const nested = useContext(InsideLoading);
  const speaks = active && !nested;
  // One shape whether it is loading or not: flipping `active` must not remount the children, or a
  // dialog's fields would lose focus and a half-typed value when its check answers (ALMA-206).
  return (
    <Tag aria-busy={speaks ? 'true' : undefined} className={className}>
      {speaks ? (
        <span role="status" className="sr-only">
          {sk.common.loading}
        </span>
      ) : null}
      <InsideLoading.Provider value={nested || active}>{children}</InsideLoading.Provider>
    </Tag>
  );
}

/** Just the „Načítavam…“ for a screen reader, for a loading shape drawn elsewhere (`TableShell`). */
export function LoadingStatus({ as: Tag = 'span' }: { as?: 'span' | 'p' }) {
  const nested = useContext(InsideLoading);
  if (nested) return null;
  return (
    <Tag role="status" className="sr-only">
      {sk.common.loading}
    </Tag>
  );
}

/** Lines of different length, so that a column of them reads as text rather than as a grid. */
const WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5'];
export const skeletonWidth = (i: number) => WIDTHS[i % WIDTHS.length]!;

/** The body rows of a table before its data: one bar per cell. Used by `TableShell` too. */
export function SkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <tr key={row} aria-hidden className="border-t border-border-subtle">
      {Array.from({ length: cols }, (_, col) => (
        <td key={col} className="h-13 px-4 py-4 first:pl-5">
          <Skeleton className={skeletonWidth(row + col)} />
        </td>
      ))}
    </tr>
  ));
}

/** A framed table of grey rows, for a table that does not go through `TableShell`. */
export function TableSkeleton({
  rows = 5,
  cols,
  className,
}: {
  rows?: number;
  cols: number;
  className?: string | undefined;
}) {
  return (
    <LoadingRegion
      className={cn(
        'overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-rest',
        className,
      )}
    >
      <table className="w-full">
        <tbody>
          <SkeletonRows rows={rows} cols={cols} />
        </tbody>
      </table>
    </LoadingRegion>
  );
}

/** Stacked lines: a list in a card, a dialog or a dropdown. No frame of its own. */
export function ListSkeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string | undefined;
}) {
  return (
    <LoadingRegion className={cn('flex flex-col divide-y divide-border-subtle', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex flex-col gap-2 py-3">
          <Skeleton className={cn('h-4', skeletonWidth(i))} />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </LoadingRegion>
  );
}

/**
 * A form field whose value is a choice from a list that has not arrived yet (the nurse of a visit):
 * a select drawn before its options would show the chosen value as empty for a moment.
 */
export function FieldSkeleton({ className }: { className?: string | undefined }) {
  return (
    <LoadingRegion className={className}>
      <Skeleton className="h-14 w-full rounded-xl" />
    </LoadingRegion>
  );
}

/** A form before the record it edits has arrived: fields in two columns, the label inside each. */
export function FormSkeleton({
  fields = 6,
  className,
}: {
  fields?: number;
  className?: string | undefined;
}) {
  return (
    <LoadingRegion className={cn('grid gap-x-4 gap-y-5 sm:grid-cols-2', className)}>
      {Array.from({ length: fields }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </LoadingRegion>
  );
}

/** A card with a title and a few lines of text. */
export function CardSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string | undefined;
}) {
  return (
    <LoadingRegion
      as="section"
      className={cn('rounded-2xl border border-border-subtle bg-white p-5 shadow-rest', className)}
    >
      <Skeleton className="h-5 w-40" />
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={skeletonWidth(i)} />
        ))}
      </div>
    </LoadingRegion>
  );
}

/** A row of KPI tiles: label, number, line. */
export function TilesSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string | undefined;
}) {
  return (
    <LoadingRegion className={cn('grid gap-5 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} aria-hidden className="flex flex-col gap-2 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-4 w-32" />
        </Card>
      ))}
    </LoadingRegion>
  );
}

/**
 * A whole screen before its data: the header bar with a title and a subtitle in grey, then the
 * body (`children`, two cards by default). For a detail page whose title is the data itself.
 */
export function PageSkeleton({ children }: { children?: ReactNode }) {
  return (
    <LoadingRegion className="min-w-0">
      <div
        aria-hidden
        className="flex min-h-[72px] flex-col justify-center gap-2 border-b border-transparent bg-white px-7 py-3"
      >
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="flex flex-col gap-5 p-7">
        {children ?? (
          <>
            <CardSkeleton lines={4} />
            <CardSkeleton lines={3} />
          </>
        )}
      </div>
    </LoadingRegion>
  );
}

/**
 * The previous data, dimmed, while the next one loads (a new filter, page, month). The content
 * stays where it is and clickable; only the dimming says that it is about to change.
 */
export function Refreshing({
  active,
  inert = false,
  children,
  className,
}: {
  active: boolean;
  /**
   * Nothing in the kept content can be used meanwhile: for a screen whose actions belong to the
   * shown period (a month's batches), not to the one that is loading.
   */
  inert?: boolean;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      aria-busy={active || undefined}
      inert={(active && inert) || undefined}
      className={cn(
        'transition-opacity motion-reduce:transition-none',
        active && 'opacity-60',
        className,
      )}
    >
      {children}
    </div>
  );
}
