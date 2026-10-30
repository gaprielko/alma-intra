import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CUSTOMER_STATUSES } from '@intra/shared/schemas';
import { Check, Inbox } from 'lucide-react';
import { useState } from 'react';
import { formatDay, KindMark, todayIso } from '@/components/activities/activity-bits';
import { ActivitySheet } from '@/components/activities/activity-sheet';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Card, CardHeader } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/overview')({
  component: OverviewPage,
});

const t = sk.activities.myNextSteps;

/**
 * Prehľad (D-15): customers by status and the latest e-mails sent on the left; received e-mails
 * waiting for a contact, my next steps and my contacts without recent contact on the right.
 */
function OverviewPage() {
  return (
    <div className="min-w-0">
      <PageHeader title={sk.overview.title} subtitle={formatDate(new Date())} />
      <main className="grid items-start gap-5 px-7 pt-5 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-5">
          <SummaryCards column="main" />
        </div>
        <div className="min-w-0 space-y-5">
          <SummaryCards column="side" />
          <NextStepsCard />
        </div>
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
                        to="/organizations/$customerId"
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

const o = sk.overview;

/** The customers in each sales status, and those without one; each opens the filtered list. */
function StatusCard({ statuses }: { statuses: Record<string, number> }) {
  const keys = [...CUSTOMER_STATUSES, 'none'] as const;
  return (
    <Card>
      <CardHeader title={o.statuses} />
      <div className="grid grid-cols-2 gap-3 px-5 pt-1 pb-5 sm:grid-cols-4 xl:grid-cols-7">
        {keys.map((key) => (
          <Link
            key={key}
            to="/organizations/customers"
            search={{ status: [key] }}
            className="rounded-xl border border-border-subtle p-3 transition-colors hover:bg-hover"
          >
            <p className="text-[22px] leading-7 font-bold tabular-nums">{statuses[key] ?? 0}</p>
            <p className="truncate text-xs text-muted">{sk.customers.chips[key]}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

type Summary = RouterOutputs['overview']['summary'];

/** The latest e-mails sent, with how many arrived, bounced and were answered. */
function CampaignsCard({ campaigns }: { campaigns: Summary['recentCampaigns'] }) {
  return (
    <Card>
      <CardHeader
        title={o.campaigns}
        action={
          <Link
            to="/emails/sent"
            className="text-[13px] font-medium text-primary-text hover:underline"
          >
            {o.allSent}
          </Link>
        }
      />
      <div className="px-5 pt-1 pb-4">
        {campaigns.length === 0 ? (
          <p className="py-2 text-sm text-muted">{o.noCampaigns}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {campaigns.map((campaign) => (
              <li key={campaign.id} className="py-3">
                <Link
                  to="/emails/sent/$campaignId"
                  params={{ campaignId: campaign.id }}
                  className="block truncate text-sm font-semibold hover:text-primary-text hover:underline"
                >
                  {campaign.subject || sk.campaigns.list.noSubject}
                </Link>
                <p className="mt-0.5 text-xs text-muted">
                  {[
                    campaign.sentAt ? formatDate(campaign.sentAt) : null,
                    o.counts(campaign.recipients, campaign.delivered, campaign.replies),
                    campaign.bounced > 0 ? o.bounced(campaign.bounced) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Received e-mails nobody filed yet: one line and a way there. */
function UnassignedCard({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Link
      to="/emails/inbox"
      search={{ view: 'unassigned' }}
      className="flex items-center gap-3 rounded-2xl border border-[#f3d9b0] bg-warning-soft px-5 py-4 text-sm font-semibold text-warning hover:brightness-[0.98]"
    >
      <Inbox className="size-4 shrink-0" aria-hidden />
      <span className="mr-auto">{o.unassigned(count)}</span>
      <span className="text-xs font-medium">{o.open}</span>
    </Link>
  );
}

/** My contacts nobody has been in touch with for a while, the longest first. */
function StaleCard({ contacts, days }: { contacts: Summary['staleContacts']; days: number }) {
  return (
    <Card>
      <CardHeader title={o.stale(days)} />
      <div className="px-5 pt-1 pb-4">
        {contacts.length === 0 ? (
          <p className="py-2 text-sm text-muted">{o.noStale}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex items-center gap-3 py-2.5">
                <Link
                  to="/organizations/$customerId"
                  params={{ customerId: contact.id }}
                  className="mr-auto truncate text-sm font-medium hover:text-primary-text hover:underline"
                >
                  {contact.name}
                </Link>
                <span className="shrink-0 text-xs text-muted">
                  {contact.lastContactAt ? formatRecent(contact.lastContactAt) : o.never}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** The e-mails waiting for their time, the next one first; nothing when none is. */
function ScheduledCard({ campaigns }: { campaigns: Summary['scheduled'] }) {
  if (campaigns.length === 0) return null;
  return (
    <Card>
      <CardHeader title={o.scheduled} />
      <ul className="divide-y divide-border-subtle px-5 pt-1 pb-4">
        {campaigns.map((campaign) => (
          <li key={campaign.id} className="py-2.5">
            <Link
              to="/emails/sent/$campaignId"
              params={{ campaignId: campaign.id }}
              className="block truncate text-sm font-medium hover:text-primary-text hover:underline"
            >
              {campaign.subject || sk.campaigns.list.noSubject}
            </Link>
            <p className="text-xs text-muted">
              {o.scheduledLine(
                campaign.scheduledAt ? formatDateTime(campaign.scheduledAt) : '',
                campaign.recipients,
              )}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The dashboard's own cards, from one query. */
function SummaryCards({ column }: { column: 'main' | 'side' }) {
  const summary = useQuery(trpc.overview.summary.queryOptions());
  if (summary.isPending) return column === 'main' ? <CardSkeleton lines={4} /> : null;
  if (loadFailed(summary)) {
    return column === 'main' ? <ErrorState compact onRetry={() => void summary.refetch()} /> : null;
  }
  const s = summary.data;
  return column === 'main' ? (
    <>
      <StatusCard statuses={s.statuses} />
      <CampaignsCard campaigns={s.recentCampaigns} />
    </>
  ) : (
    <>
      <UnassignedCard count={s.unassignedReplies} />
      <ScheduledCard campaigns={s.scheduled} />
      <StaleCard contacts={s.staleContacts} days={s.staleDays} />
    </>
  );
}
