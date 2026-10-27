import { redirect } from '@tanstack/react-router';
import { clearToasts } from '@/components/ui/toast';
import { useSession } from './session';
import { queryClient, trpc } from './trpc';

/**
 * Makes sure a session is loaded before a protected route renders. The tokens are httpOnly
 * cookies, so "am I logged in" can only be answered by asking the API.
 */
export async function requireSession() {
  if (useSession.getState().actor) return;
  if (!(await restoreSession())) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/login' });
  }
}

/**
 * Loads the session from the cookies if there is one, without sending anybody anywhere: `true`
 * when somebody is signed in. For the pages a signed-out visitor may see too (the login, a missing
 * page), which must still know a signed-in one in a new tab.
 *
 * `quick`: ask once and answer `false` at once on any failure, offline included, instead of the
 * client's retries and its wait for the network: a public page renders on that answer.
 */
export async function restoreSession({
  quick = false,
}: { quick?: boolean } = {}): Promise<boolean> {
  if (useSession.getState().actor) return true;
  try {
    const me = await queryClient.fetchQuery({
      ...trpc.auth.me.queryOptions(),
      staleTime: 0,
      ...(quick ? { retry: false, networkMode: 'always' as const } : {}),
    });
    useSession.getState().setSession(me);
    return true;
  } catch {
    return false;
  }
}

export function endSession() {
  useSession.getState().clear();
  queryClient.clear();
  clearToasts();
}
