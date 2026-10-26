import type { AppRouter } from '@intra/api/src/trpc/app.router.js';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

const hasCode = (error: unknown, code: string) =>
  error instanceof TRPCClientError && (error.data as { code?: string } | undefined)?.code === code;

export const isUnauthorized = (error: unknown) => hasCode(error, 'UNAUTHORIZED');

export const queryClient = new QueryClient({
  queryCache: new QueryCache(),
  mutationCache: new MutationCache(),
  defaultOptions: {
    queries: {
      retry: (count, error) => !isUnauthorized(error) && count < 2,
    },
  },
});

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const send = (input: FetchInput, init?: FetchInit) =>
  fetch(input, { ...init, credentials: 'include' });

let refreshing: Promise<number> | null = null;
/**
 * When this tab last rotated the refresh token. Unknown at load (0): a page opened with an access
 * token still valid holds a refresh token rotated up to 15 minutes before, so the first interaction
 * rotates rather than trusting that; otherwise the server's hour could end before the tab's.
 */
let lastRotation = 0;
/** One refresh at a time, however many callers need one together; answers the HTTP status. */
function rotate(): Promise<number> {
  refreshing ??= send('/trpc/auth.refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
    .then((res) => {
      if (res.ok) lastRotation = Date.now();
      return res.status;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
const refreshSession = () => rotate().then((status) => status >= 200 && status < 300);

const KEEP_ALIVE_EVERY_MS = 5 * 60_000;

/**
 * The server refuses a refresh token nobody used for an hour, and only a request uses it: somebody
 * writing for an hour sends none, and would be active to the tab and idle to the server. So
 * interaction rotates the token as well, at most every 5 minutes; the server's hour then runs out
 * no sooner than 55 minutes after the last interaction, and the tab's own timer does the rest.
 *
 * A 401 is the server's verdict that the session is over: `onEnded` signs out at once. Anything
 * else (offline, rate limited, a server error) says nothing about the session.
 */
export function keepSessionAlive(onEnded: () => void) {
  if (Date.now() - lastRotation < KEEP_ALIVE_EVERY_MS) return;
  lastRotation = Date.now();
  void rotate().then(
    (status) => {
      if (status === 401) onEnded();
    },
    () => undefined,
  );
}

// `auth.me` must be retried (it is how a returning user's session is restored); these must not.
// The second step answers 401 for a dead challenge: there is no session to refresh.
const NO_REFRESH =
  /\/trpc\/auth\.(login|refresh|logout|acceptInvitation|secondFactorVerify|secondFactorSetup|secondFactorEnrol)\b/;

const pathOf = (input: FetchInput) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

// `init as FetchInit`: tRPC's init type carries explicit `undefined`s (exactOptionalPropertyTypes).
/** The access token lives 15 minutes in an httpOnly cookie: on 401 rotate it once and retry. */
const fetchWithRefresh: NonNullable<Parameters<typeof httpBatchLink>[0]['fetch']> = async (
  input,
  init,
) => {
  const response = await send(input, init as FetchInit);
  if (response.status !== 401 || NO_REFRESH.test(pathOf(input))) return response;
  return (await refreshSession()) ? send(input, init as FetchInit) : response;
};

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/trpc',
      // Queries as POST: a search term or an id in a URL ends up in proxy and hosting logs.
      methodOverride: 'POST',
      fetch: fetchWithRefresh,
      // The server refuses larger batches (MAX_BATCH_SIZE in the API's tRPC module).
      maxItems: 10,
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });
export { trpcClient };
