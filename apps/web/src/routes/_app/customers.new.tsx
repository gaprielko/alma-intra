import { ORGANIZATION_ROLES } from '@intra/shared/schemas';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

/** A new organization moved to /organizations/new; old links land there. */
export const Route = createFileRoute('/_app/customers/new')({
  validateSearch: z.object({ role: z.enum(ORGANIZATION_ROLES).optional() }),
  beforeLoad: ({ search }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/organizations/new', search, replace: true });
  },
});
