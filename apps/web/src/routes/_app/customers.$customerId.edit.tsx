import { createFileRoute, redirect } from '@tanstack/react-router';

/** Editing an organization moved to /organizations/<id>/edit; old links land there. */
export const Route = createFileRoute('/_app/customers/$customerId/edit')({
  beforeLoad: ({ params }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/organizations/$customerId/edit', params, replace: true });
  },
});
