import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/emails')({
  beforeLoad: ({ location }) => {
    // E-maily open on the templates until sending (E5) and replies (E6) have their pages.
    if (location.pathname.replace(/\/$/, '') === '/emails')
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
      throw redirect({ to: '/emails/templates', replace: true });
  },
  component: Outlet,
});
