import { sk } from '@intra/shared/i18n';
import { PAGE_SIZE } from '@intra/shared/schemas';
import { Link, type RegisteredRouter, type ValidateLinkOptions } from '@tanstack/react-router';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type AriaAttributes, type ReactNode } from 'react';
import { LoadingStatus, SkeletonRows } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Every table of the web app looks the same (ALMA-170, item 24): one frame, one header style, one
 * „Žiadne …“ row, one footer. The pieces:
 *
 * - `TableShell` draws the frame, the column headers and the body rows the caller writes with
 *   `TableRow` / `TableCell` from `@/components/ui/table`. It shows skeleton rows while loading
 *   and a single full-width message row (the empty text, or an error) instead of data rows.
 * - `TablePagination` is the footer of a paged table: the count („1–20 z 42“, nothing under an
 *   empty table), the arrows only when there is more than one page. The page size is `PAGE_SIZE`
 *   from `@intra/shared`.
 * - `TableShowAll` is the footer of a deliberate short preview (a dashboard card): a link to the
 *   whole list instead of paging.
 * - `useClientPaging` pages rows that arrived all at once, for tables whose endpoint returns the
 *   whole set; server-paged lists pass their own page and total to `TablePagination`.
 *
 * ```tsx
 * const { rows, pagination } = useClientPaging(items);
 * <TableShell
 *   columns={[t.columns.name, t.columns.status]}
 *   message={items.length === 0 ? t.empty : null}
 *   footer={<TablePagination {...pagination} />}
 * >
 *   {rows.map((row) => <TableRow key={row.id}>…</TableRow>)}
 * </TableShell>
 * ```
 */

export function TableShell({
  columns,
  children,
  header,
  message,
  loading = false,
  refreshing = false,
  footer,
  className,
  columnClassNames,
  columnSort,
}: {
  /** One header cell each, in order. A column without a visible title passes an `sr-only` span. */
  columns: ReactNode[];
  /**
   * Classes for the header cell of each column, by index: a width, or the breakpoint a column
   * appears at (`hidden wide:table-cell`), matched by the same class on the body cells.
   */
  columnClassNames?: (string | undefined)[];
  /** ALMA-357: `aria-sort` of each header cell, by index, for a list that sorts by its columns. */
  columnSort?: AriaAttributes['aria-sort'][];
  /** The body rows: `TableRow`s with one `TableCell` per column. */
  children?: ReactNode;
  /** Above the table, inside the frame: a card's title and its action (`CardHeader`). */
  header?: ReactNode;
  /**
   * One full-width row instead of data: the empty text („Žiadne …“) or an error with a retry.
   * Leave it out (or pass `null`) when there are rows.
   */
  message?: ReactNode;
  /**
   * Skeleton rows before the first data arrives. Pass the query's `isPending`, never leave the
   * `message` to say „Žiadne …“ meanwhile: it only shows once `loading` is over (ALMA-205).
   */
  loading?: boolean;
  /** The rows are the previous page's or filter's while the next load runs: dimmed, not blanked. */
  refreshing?: boolean;
  /** `TablePagination` for a full list, `TableShowAll` for a preview. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'min-w-0 overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-rest',
        className,
      )}
    >
      {header}
      {/* `relative`: an `sr-only` header inside is placed within the frame, not past the page. */}
      <div className={cn('relative overflow-x-auto', header ? 'mt-3' : undefined)}>
        <Table>
          <TableHeader>
            <TableRow className="border-t-0">
              {columns.map((column, i) => (
                <TableHead key={i} className={columnClassNames?.[i]} aria-sort={columnSort?.[i]}>
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody
            aria-busy={loading || refreshing || undefined}
            className={cn(
              'transition-opacity motion-reduce:transition-none',
              refreshing && !loading && 'opacity-60',
            )}
          >
            {loading ? <SkeletonRows cols={columns.length} /> : children}
            {!loading && message ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-auto py-10 text-center text-sm text-muted"
                >
                  {message}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {/* Nothing to count before the rows are there. */}
      {loading ? <LoadingStatus as="p" /> : footer}
    </section>
  );
}

/**
 * First and last row number of a page, as shown in the footer („11–20 z 42“). A page past the end
 * (`?page=99` typed by hand) has no rows: 0–0, not „981–42“.
 */
export function pageRange(page: number, pageSize: number, total: number) {
  const from = (page - 1) * pageSize + 1;
  if (from > total) return { from: 0, to: 0, isLast: true };
  const to = Math.min(page * pageSize, total);
  return { from, to, isLast: to >= total };
}

/**
 * The arrows show only when there is somewhere to go: more rows than one page holds, or a page
 * past the first (a list that shrank under the user must still lead back).
 */
export function showsPageArrows(page: number, pageSize: number, total: number) {
  return total > pageSize || page > 1;
}

/**
 * An empty table has nothing to count: no „0–0 z 0“ under its empty state (ALMA-284 item 40). A
 * later page of a list that emptied under the user keeps the footer, for the arrow back.
 */
export function showsPagination(page: number, total: number | undefined) {
  return total !== 0 || page > 1;
}

export interface TablePaginationProps {
  page: number;
  pageSize?: number;
  /** Undefined until the first page has loaded: the footer stays, the count waits. */
  total: number | undefined;
  onPageChange: (page: number) => void;
}

/** The footer of every paged table: the count while there are rows, the arrows only with more than one page. */
export function TablePagination({
  page,
  pageSize = PAGE_SIZE,
  total,
  onPageChange,
}: TablePaginationProps) {
  const range = total === undefined ? null : pageRange(page, pageSize, total);
  if (!showsPagination(page, total)) return null;
  return (
    <footer className="flex min-h-16 items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
      <p className="text-xs text-muted">
        {range ? sk.common.range(range.from, range.to, total ?? 0) : null}
      </p>
      {total !== undefined && showsPageArrows(page, pageSize, total) ? (
        <div className="flex gap-2">
          <Button
            size="icon"
            aria-label={sk.common.previousPage}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button
            size="icon"
            aria-label={sk.common.nextPage}
            disabled={!range || range.isLast}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      ) : null}
    </footer>
  );
}

/** The footer of a short preview: „Zobraziť všetky“ leads to the whole list, nothing pages. */
export function TableShowAll<TRouter extends RegisteredRouter, TOptions>(props: {
  link: ValidateLinkOptions<TRouter, TOptions>;
}): ReactNode;
export function TableShowAll({ link }: { link: ValidateLinkOptions }) {
  return (
    <footer className="flex min-h-16 items-center border-t border-border-subtle px-5 py-3">
      <Link
        {...link}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-text hover:underline"
      >
        {sk.common.showAll}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </footer>
  );
}

/** The rows of one page of a set that arrived whole; a page past the end falls back to the last. */
export function pageOf<T>(rows: readonly T[], page: number, pageSize = PAGE_SIZE) {
  const last = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), last);
  return { page: current, rows: rows.slice((current - 1) * pageSize, current * pageSize) };
}

/**
 * Pages a table whose rows arrived all at once. The page is component state; it snaps back into
 * range when the rows shrink (a filter, a removed row), and `resetKey` (the filters, as a string)
 * starts over at page 1 when the view changes.
 */
export function useClientPaging<T>(rows: readonly T[], resetKey = '') {
  const [state, setState] = useState({ page: 1, resetKey });
  const requested = state.resetKey === resetKey ? state.page : 1;
  const current = pageOf(rows, requested);
  const pagination: TablePaginationProps = {
    page: current.page,
    pageSize: PAGE_SIZE,
    total: rows.length,
    onPageChange: (page) => setState({ page, resetKey }),
  };
  return { rows: current.rows, pagination };
}
