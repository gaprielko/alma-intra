import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { endSession } from './auth';
import { trpc } from './trpc';
import { useInactivityLogout } from './use-inactivity-logout';

/**
 * Logout, including the one-hour inactivity logout and whether its warning is due (the shell
 * renders `IdleWarning`).
 */
export function useSignOut() {
  const navigate = useNavigate();
  const logout = useMutation(trpc.auth.logout.mutationOptions());

  const signOut = useCallback(
    async (reason?: 'inactive') => {
      // The server clears the cookies even for an expired session; only a request that never
      // reaches it leaves them, and then `/login` may find the session still there.
      await logout.mutateAsync().catch(() => undefined);
      endSession();
      await navigate({ to: '/login', search: reason ? { reason } : {} });
    },
    [logout, navigate],
  );
  const idleWarning = useInactivityLogout(useCallback(() => void signOut('inactive'), [signOut]));
  return { signOut, idleWarning };
}
