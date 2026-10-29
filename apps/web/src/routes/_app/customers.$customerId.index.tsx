import { createFileRoute, redirect } from '@tanstack/react-router';

/** An organization's page moved to /organizations/<id>; old links and bookmarks land there. */
export const Route = createFileRoute('/_app/customers/$customerId/')({
  beforeLoad: ({ params }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/organizations/$customerId', params, replace: true });
  },
});
