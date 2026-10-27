import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { formatDay, KindMark, todayIso } from '@/components/activities/activity-bits';
import { ActivitySheet } from '@/components/activities/activity-sheet';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Card, CardHeader } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/overview')({
  component: OverviewPage,
});

const t = sk.activities.myNextSteps;

/** Prehľad: for now the person's open next steps; the dashboard (D-15) joins it in E8. */
function OverviewPage() {
  return (
    <div className="min-w-0">
      <PageHeader title={sk.overview.title} subtitle={formatDate(new Date())} />
      <main className="grid max-w-[1400px] gap-5 px-7 pt-5 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <NextStepsCard />
      </main>
    </div>
  );
}

function NextStepsCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const steps = useQuery(trpc.activity.myNextSteps.queryOptions());
  const [openId, setOpenId] = useState<string | null>(null);
  const done = useMutation(
    trpc.activity.setNextStepDone.mutationOptions({
      onSuccess: async () => {
        toast('success', t.doneToast);
        await queryClient.invalidateQueries(trpc.activity.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.activities.errors)),
    }),
  );
  if (steps.isPending) return <CardSkeleton lines={4} />;
  const today = todayIso();
  return (
    <Card>
      <CardHeader
        title={t.title}
        action={
          steps.data && steps.data.length > 0 ? (
            <span className="text-[13px] font-medium text-muted">{t.open(steps.data.length)}</span>
          ) : null
        }
      />
      <div className="px-5 pt-2 pb-4">
        {loadFailed(steps) ? (
          <ErrorState compact onRetry={() => void steps.refetch()} />
        ) : steps.data.length === 0 ? (
          <p className="py-2 text-sm text-muted">{t.empty}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {steps.data.map((step) => {
              const overdue = step.due !== null && step.due < today;
              return (
                <li key={step.id} className="flex items-start gap-3 py-3">
                  <button
                    type="button"
                    aria-label={t.markDone(step.text)}
                    disabled={done.isPending}
                    onClick={() => done.mutate({ id: step.id, done: true })}
                    className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-border text-transparent transition-colors hover:border-primary hover:text-primary"
                  >
                    <Check className="size-3.5" aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setOpenId(step.id)}
                      className="text-left text-sm font-semibold hover:text-primary-text hover:underline"
                    >
                      {step.text}
                    </button>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <KindMark kind={step.kind} size="sm" />
                      <Link
                        to="/customers/$customerId"
                        params={{ customerId: step.customerId }}
                        className="hover:text-primary-text hover:underline"
                      >
                        {t.from(step.customerName, formatDate(step.occurredAt))}
                      </Link>
                    </p>
                  </div>
                  {step.due ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                        overdue ? 'bg-danger-soft text-danger' : 'bg-surface text-muted',
                      )}
                    >
                      {overdue ? t.overdue(formatDay(step.due)) : t.due(formatDay(step.due))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {openId ? <ActivitySheet activityId={openId} onClose={() => setOpenId(null)} /> : null}
    </Card>
  );
}
