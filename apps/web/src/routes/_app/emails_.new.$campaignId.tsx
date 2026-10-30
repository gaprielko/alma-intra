import { sk } from '@intra/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DirectComposer } from '@/components/emails/direct-composer';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Card } from '@/components/ui/card';
import { errorMessage } from '@/lib/errors';
import { loadFailed } from '@/lib/query-view';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/emails_/new/$campaignId')({ component: NewEmailPage });

const t = sk.directEmail;

function NewEmailPage() {
  const { campaignId } = Route.useParams();
  const navigate = useNavigate();
  const draft = useQuery({
    ...trpc.campaign.getDirect.queryOptions({ id: campaignId }),
    // The form takes over from here: a refetch must not overwrite what is being typed.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const look = useQuery(trpc.template.look.queryOptions());
  const back = { to: '/emails/inbox', label: sk.inbound.back } as const;
  if (draft.isPending || look.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.title} back={back} />
        <div className="p-7">
          <CardSkeleton lines={8} />
        </div>
      </div>
    );
  }
  if (loadFailed(draft) || loadFailed(look)) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.title} back={back} />
        <ErrorState
          text={errorMessage(draft.error, sk.campaigns.errors)}
          onRetry={() => void draft.refetch()}
        />
      </div>
    );
  }
  return (
    <DirectComposer
      key={campaignId}
      draft={draft.data}
      look={look.data.look}
      onSent={() => navigate({ to: '/emails/sent/$campaignId', params: { campaignId } })}
      onDiscarded={() => navigate({ to: '/emails/inbox' })}
    >
      {({ fields, send, discard, from }) => (
        <div className="min-w-0">
          <PageHeader title={t.title} subtitle={from} back={back}>
            {discard}
            {send}
          </PageHeader>
          <main className="px-7 pt-5 pb-10">
            <Card className="mx-auto max-w-[56rem] overflow-visible">{fields}</Card>
          </main>
        </div>
      )}
    </DirectComposer>
  );
}
