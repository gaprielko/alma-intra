import { createFileRoute, redirect } from '@tanstack/react-router';
import { requireSession } from '@/lib/auth';
import { HOME_PATH } from '@/lib/session';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    await requireSession();
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: HOME_PATH });
  },
});
