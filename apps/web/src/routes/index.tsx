import { createFileRoute, redirect } from '@tanstack/react-router';
import { PENDING_CONSENT_KEY, requireSession } from '@/lib/auth';
import { HOME_PATH } from '@/lib/session';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    await requireSession();
    // Claude asked for access before she signed in: back to that question.
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_CONSENT_KEY);
    } catch {
      pending = null;
    }
    if (pending) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
      throw redirect({ to: '/oauth/consent', search: { request: pending } });
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: HOME_PATH });
  },
});
