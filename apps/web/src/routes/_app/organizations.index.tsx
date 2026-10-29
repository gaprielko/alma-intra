import { createFileRoute, redirect } from '@tanstack/react-router';

/** Organizácie opens on its first tab, Zákazníci. */
export const Route = createFileRoute('/_app/organizations/')({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/organizations/customers', replace: true });
  },
});
