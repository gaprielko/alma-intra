/**
 * Which of four faces a screen shows for one query (ALMA-205):
 *
 * - `loading` — nothing has arrived yet: a skeleton in the shape of the content;
 * - `error` — the load failed: the error, with the screen's own `errorMessage` wording;
 * - `empty` — the load succeeded with nothing in it: the empty state („Žiadne …“);
 * - `data` — the content.
 *
 * The empty state is never shown before a successful load: that was the flash of „nič tu nie je“
 * before the rows appeared. A query kept on the previous data (`placeholderData:
 * keepPreviousData`) stays `data` while the next one loads; `isRefreshing` tells the screen to dim
 * it meanwhile. Data in hand wins over an error: see `loadFailed`.
 */
export type QueryView = 'loading' | 'error' | 'empty' | 'data';

/** The part of a React Query result this needs; tests pass plain objects. */
export interface QueryState<T> {
  status: 'pending' | 'error' | 'success';
  data: T | undefined;
}

/** An array with no items is empty; anything else needs the screen's own `isEmpty`. */
const emptyArray = (data: unknown) => Array.isArray(data) && data.length === 0;

export function queryView<T>(
  query: QueryState<T>,
  isEmpty: (data: T) => boolean = emptyArray,
): QueryView {
  if (loadFailed(query)) return 'error';
  if (query.data === undefined) return 'loading';
  return isEmpty(query.data) ? 'empty' : 'data';
}

/**
 * Whether a screen (or a part of one) shows its error state: the load failed and there is nothing
 * to show instead (ALMA-288 item 64). `isError` alone is not that. React Query keeps a query whose
 * refetch failed (a refocused tab or Dnes's minute while the API restarts for a deploy) in
 * `error` with the data it had, and keeps it there while the next refetch runs. A screen asking
 * `isError` then swapped its content for the error, and every later visit to it flashed the
 * error, illustration and all, for the second the refetch took before the page came back. With
 * data in hand the screen shows it; the header's chip says that a load failed and offers
 * „Skúsiť znova“ (ALMA-288 item 11). A load with nothing in hand is `pending` again while it
 * retries, so its skeleton shows, never this.
 *
 * Used where a screen read `isError`: `if (query.isPending)` for the skeleton, then
 * `if (loadFailed(query))` for the error, after which `query.data` is the data.
 */
export function loadFailed<Q extends QueryState<unknown>>(
  query: Q,
): query is Extract<Q, { status: 'error'; data: undefined }> {
  return query.status === 'error' && query.data === undefined;
}

/**
 * The shown data is the previous key's, kept while the new one loads (a filter, a page, a month):
 * dim it rather than blank it. A background refetch of the same key (every minute on Dnes) is not
 * a refresh the user asked for and does not dim anything.
 */
export function isRefreshing(query: { isPlaceholderData: boolean }): boolean {
  return query.isPlaceholderData;
}

/**
 * The input a tRPC query was asked with, read from its key (`[path, { input, type }]`). For a
 * `placeholderData` that keeps the previous answer only while part of the input stays the same:
 * the same patient's procedures while the time changes, never another patient's.
 */
export function keyInput(
  query: { queryKey: readonly unknown[] } | undefined,
): Readonly<Record<string, unknown>> | undefined {
  const args = query?.queryKey[1] as { input?: unknown } | undefined;
  const input = args?.input;
  return input !== null && typeof input === 'object'
    ? (input as Record<string, unknown>)
    : undefined;
}
