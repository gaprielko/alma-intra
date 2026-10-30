import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Field } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/activities/$activityId')({
  component: ActivityPage,
});

const t = sk.leadActivities;
const d = t.detail;
const LINK = 'font-medium text-primary-text hover:underline';

/** One entry of Aktivity: what happened, who it was, which e-mail it came from. */
function ActivityPage() {
  const { activityId } = Route.useParams();
  const activity = useQuery(trpc.leadActivity.get.queryOptions({ id: activityId }));
  const canDelete = useCan('activity.delete');
  const [removing, setRemoving] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation(
    trpc.leadActivity.delete.mutationOptions({
      onSuccess: async () => {
        toast('success', d.deleteConfirm.done);
        await queryClient.invalidateQueries(trpc.leadActivity.pathFilter());
        await navigate({ to: '/activities' });
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const row = activity.data;
  const back = { to: '/activities', label: t.title } as const;
  if (!row) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.title} back={back} />
        <main className="px-7 pt-5 pb-10">
          {loadFailed(activity) ? (
            <ErrorState onRetry={() => void activity.refetch()} />
          ) : (
            <CardSkeleton lines={4} />
          )}
        </main>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <PageHeader title={d.title(t.types[row.type], row.productName)} back={back}>
        {canDelete ? (
          <Button variant="secondary" onClick={() => setRemoving(true)}>
            {d.delete}
          </Button>
        ) : null}
      </PageHeader>
      <main className="grid max-w-[1080px] items-start gap-5 px-7 pt-5 pb-10 md:grid-cols-2">
        <Card>
          <CardHeader title={d.what} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 pt-3 pb-5">
            <Field label={d.type}>
              <Badge tone="info" dot>
                {t.types[row.type]}
              </Badge>
            </Field>
            <Field label={d.product}>
              <Link
                to="/products/$productId"
                params={{ productId: row.productId }}
                className="inline-flex rounded-md bg-info-soft px-2 py-0.5 text-xs font-semibold text-info"
              >
                {row.productName}
              </Link>
            </Field>
            <Field label={d.createdAt}>{formatDateTime(row.createdAt)}</Field>
            <Field label={d.lastConfirmedAt}>{formatDateTime(row.lastConfirmedAt)}</Field>
            <Field label={d.way}>{d.wayButton}</Field>
          </dl>
        </Card>
        <Card>
          <CardHeader title={d.who} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 pt-3 pb-5">
            <Field label={d.organization}>
              <Link
                to="/organizations/$customerId"
                params={{ customerId: row.organizationId }}
                className={LINK}
              >
                {row.organizationName}
              </Link>
              <span className="block text-xs text-muted">
                {[row.parentName, t.roles[row.organizationRole]].filter(Boolean).join(' · ')}
              </span>
            </Field>
            <Field label={d.contact}>
              {row.contactId ? (
                <Link
                  to="/contacts/$personId"
                  params={{ personId: row.contactId }}
                  className={LINK}
                >
                  {row.contactName}
                </Link>
              ) : (
                t.noContact
              )}
            </Field>
            <Field label={d.email}>{row.email ?? sk.common.none}</Field>
            <Field label={d.phone}>{row.phone ?? sk.common.none}</Field>
          </dl>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader title={d.source} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 pt-3 pb-5">
            <Field label={d.subject}>
              {row.campaignId ? (
                <Link
                  to="/emails/sent/$campaignId"
                  params={{ campaignId: row.campaignId }}
                  className={LINK}
                >
                  {row.subject}
                </Link>
              ) : (
                sk.common.none
              )}
            </Field>
            <Field label={d.template}>
              {row.templateId ? (
                <Link
                  to="/emails/templates/$templateId"
                  params={{ templateId: row.templateId }}
                  className={LINK}
                >
                  {row.templateName}
                </Link>
              ) : (
                sk.common.none
              )}
            </Field>
            <Field label={d.sender}>{row.sender ?? sk.common.none}</Field>
            <Field label={d.sentAt}>
              {row.sentAt ? formatDateTime(row.sentAt) : sk.common.none}
            </Field>
          </dl>
        </Card>
      </main>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={d.deleteConfirm.title}
        description={d.deleteConfirm.text}
        confirmLabel={d.deleteConfirm.confirm}
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: row.id })}
      />
    </div>
  );
}
