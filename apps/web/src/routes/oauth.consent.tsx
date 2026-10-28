import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { PENDING_CONSENT_KEY, restoreSession } from '@/lib/auth';
import { loadFailed } from '@/lib/query-view';
import { useSession } from '@/lib/session';
import { trpc } from '@/lib/trpc';

const t = sk.oauth;

export const Route = createFileRoute('/oauth/consent')({
  validateSearch: z.object({ request: z.string().uuid().optional() }),
  beforeLoad: async ({ search }) => {
    if (await restoreSession()) return;
    try {
      if (search.request) sessionStorage.setItem(PENDING_CONSENT_KEY, search.request);
    } catch {
      // Without storage she comes back to the home page and starts again from Claude.
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/login' });
  },
  component: ConsentPage,
});

/**
 * Claude asks for access (OAuth, D-31): which application, signed in as whom, what it may do; the
 * user approves or refuses, and the browser goes back to the application.
 */
function ConsentPage() {
  const { request } = Route.useSearch();
  const user = useSession((s) => s.user);
  const details = useQuery({
    ...trpc.oauth.request.queryOptions({ request: request ?? '' }),
    enabled: Boolean(request),
    retry: false,
  });
  const decide = useMutation(
    trpc.oauth.decide.mutationOptions({
      onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
    }),
  );
  try {
    sessionStorage.removeItem(PENDING_CONSENT_KEY);
  } catch {
    // Nothing to forget.
  }
  const invalid = !request || loadFailed(details) || decide.isError;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f4f6f6] px-4 py-10">
      <div className="w-full max-w-[30rem] rounded-2xl bg-white p-7 shadow-raised">
        <div className="mb-5 flex items-center gap-2.5">
          <BrandMark className="size-8 bg-linear-160 from-[#18a5a7] to-[#0b7375]" />
          <span className="text-lg font-bold">{sk.brand.name}</span>
        </div>
        {invalid ? (
          <p role="alert" className="text-sm text-danger">
            {t.expired}
          </p>
        ) : !details.data ? (
          <p role="status" className="text-sm text-muted">
            {sk.common.loading}
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-bold">{t.title(details.data.clientName ?? t.unnamed)}</h1>
              <p className="mt-2 text-sm text-muted">{t.signedInAs(user?.name ?? '')}</p>
            </div>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              {t.may.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-sm text-muted">{t.never}</p>
            <p className="text-xs text-muted">{t.returnsTo(details.data.redirectHost)}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ request, approve: false })}
              >
                {t.deny}
              </Button>
              <Button
                disabled={decide.isPending}
                onClick={() => decide.mutate({ request, approve: true })}
              >
                {t.approve}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
