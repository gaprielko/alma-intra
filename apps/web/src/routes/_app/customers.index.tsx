import { createFileRoute, redirect } from '@tanstack/react-router';

/** The list moved to Organizácie › Zákazníci (docs/contacts-redesign.md); old links land there. */
export const Route = createFileRoute('/_app/customers/')({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/organizations/customers', replace: true });
  },
});
