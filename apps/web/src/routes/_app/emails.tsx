import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/emails')({
  beforeLoad: ({ location }) => {
    // E-maily open on what came back: replies first.
    if (location.pathname.replace(/\/$/, '') === '/emails')
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
      throw redirect({ to: '/emails/inbox', replace: true });
  },
  component: EmailsLayout,
});

// The same tabs as Organizácie and Produkty.
const tabClass =
  '-mb-px inline-flex h-[46px] items-center gap-2 border-b-2 px-3.5 text-sm font-semibold whitespace-nowrap';
const activeTabClass = 'border-primary text-primary-text';
const inactive = { className: 'border-transparent text-muted hover:text-foreground' };

/** E-maily: the header with „Nový e-mail“, the tabs, and the chosen list. */
function EmailsLayout() {
  const t = sk.emails;
  const toast = useToast();
  const navigate = useNavigate();
  const canSend = useCan('email.send');
  const look = useQuery(trpc.template.look.queryOptions());
  // Kept fresh with the list itself (every 30 s).
  const unassigned = useQuery({
    ...trpc.inbound.list.queryOptions({ view: 'unassigned' }),
    refetchInterval: 30_000,
  }).data?.unassigned;
  const create = useMutation(
    trpc.campaign.create.mutationOptions({
      onSuccess: (created) =>
        navigate({ to: '/emails/compose/$campaignId', params: { campaignId: created.id } }),
      onError: (error) => toast('error', errorMessage(error, sk.campaigns.errors)),
    }),
  );
  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={look.data ? t.subtitle(look.data.senderAddress) : undefined}
      >
        {canSend ? (
          <Button disabled={create.isPending} onClick={() => create.mutate({ customerIds: [] })}>
            <Plus className="size-4" aria-hidden />
            {sk.campaigns.newEmail}
          </Button>
        ) : null}
      </PageHeader>
      <nav
        aria-label={t.tabs.label}
        className="flex gap-1 overflow-x-auto border-b border-border bg-white/80 px-7"
      >
        <Link
          to="/emails/inbox"
          className={tabClass}
          activeProps={{ className: activeTabClass }}
          inactiveProps={inactive}
        >
          {t.tabs.inbox}
          {unassigned ? (
            <span className="rounded-full bg-warning-soft px-2 text-xs font-semibold text-warning tabular-nums">
              {unassigned}
            </span>
          ) : null}
        </Link>
        <Link
          to="/emails/sent"
          className={tabClass}
          activeProps={{ className: activeTabClass }}
          inactiveProps={inactive}
        >
          {t.tabs.sent}
        </Link>
        <Link
          to="/emails/drafts"
          className={tabClass}
          activeProps={{ className: activeTabClass }}
          inactiveProps={inactive}
        >
          {t.tabs.drafts}
        </Link>
        <Link
          to="/emails/templates"
          className={tabClass}
          activeProps={{ className: activeTabClass }}
          inactiveProps={inactive}
        >
          {t.tabs.templates}
        </Link>
      </nav>
      <Outlet />
    </>
  );
}
