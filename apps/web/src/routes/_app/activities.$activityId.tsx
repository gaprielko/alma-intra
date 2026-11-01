import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useDebounced } from '@/components/customers/organization-list';
import { PersonDialog } from '@/components/customers/person-dialog';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Field } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/activities/$activityId')({
  component: ActivityPage,
});

const t = sk.leadActivities;
const d = t.detail;
const LINK = 'font-medium text-primary-text hover:underline';

type Entry = RouterOutputs['leadActivity']['get'];

const kindOf = (kind: string | null) =>
  kind ? ((t.feedbackKinds as Record<string, string>)[kind] ?? kind) : sk.common.none;
const clientOf = (client: string | null) =>
  client ? ((t.feedbackClients as Record<string, string>)[client] ?? client) : null;

/** One entry of Aktivity: what happened, who it was, where it came from. */
function ActivityPage() {
  const { activityId } = Route.useParams();
  const activity = useQuery(trpc.leadActivity.get.queryOptions({ id: activityId }));
  const canDelete = useCan('activity.delete');
  const canWrite = useCan('activity.write');
  const [removing, setRemoving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
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
  const link = useMutation(
    trpc.leadActivity.assign.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.leadActivity.pathFilter()),
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
  const fromApp = row.source === 'app';
  if (row.source === 'share') {
    return (
      <div className="min-w-0">
        <PageHeader title={row.typeName} back={back}>
          {canDelete ? (
            <Button variant="secondary" onClick={() => setRemoving(true)}>
              {d.delete}
            </Button>
          ) : null}
        </PageHeader>
        <DocumentChange id={row.id} createdAt={row.createdAt} typeName={row.typeName} />
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
  return (
    <div className="min-w-0">
      <PageHeader
        title={
          fromApp
            ? `${row.typeName} · ${t.fromApp(row.productName ?? '')}`
            : d.title(row.typeName, row.productName ?? '')
        }
        back={back}
      >
        {canWrite && fromApp && !row.organizationId ? (
          <Button onClick={() => setAssigning(true)}>{d.assign}</Button>
        ) : null}
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
                {row.typeName}
              </Badge>
            </Field>
            {fromApp ? <Field label={d.kind}>{kindOf(row.feedbackKind)}</Field> : null}
            <Field label={d.product}>
              {row.productId ? (
                <Link
                  to="/products/$productId"
                  params={{ productId: row.productId }}
                  className="inline-flex rounded-md bg-info-soft px-2 py-0.5 text-xs font-semibold text-info"
                >
                  {row.productName}
                </Link>
              ) : (
                sk.common.none
              )}
            </Field>
            <Field label={d.createdAt}>{formatDateTime(row.createdAt)}</Field>
            {fromApp ? null : (
              <>
                <Field label={d.lastConfirmedAt}>{formatDateTime(row.lastConfirmedAt)}</Field>
                <Field label={d.confirmedCount}>{row.confirmedCount}</Field>
                <Field label={d.way}>{d.wayButton}</Field>
              </>
            )}
          </dl>
        </Card>
        <Card>
          <CardHeader title={d.who} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 pt-3 pb-5">
            <Field label={d.organization}>
              <Organization row={row} />
            </Field>
            {row.parentId ? (
              <Field label={d.workplace}>
                <Link
                  to="/organizations/$customerId"
                  params={{ customerId: row.organizationId ?? '' }}
                  className={LINK}
                >
                  {row.organizationName}
                </Link>
              </Field>
            ) : null}
            <Field label={d.contact}>
              {row.contactId ? (
                <Link
                  to="/contacts/$personId"
                  params={{ personId: row.contactId }}
                  className={LINK}
                >
                  {row.contactName}
                </Link>
              ) : fromApp ? (
                <>
                  {row.reporterName}
                  {canWrite ? (
                    <button
                      type="button"
                      className={cn(LINK, 'block text-xs')}
                      onClick={() => setAddingContact(true)}
                    >
                      {d.newContact}
                    </button>
                  ) : null}
                </>
              ) : (
                t.noContact
              )}
            </Field>
            <Field label={fromApp ? d.reporterEmail : d.email}>{row.email ?? sk.common.none}</Field>
            {row.contactId ? <Field label={d.phone}>{row.phone ?? sk.common.none}</Field> : null}
          </dl>
        </Card>
        {fromApp ? (
          <FeedbackContent id={row.id} />
        ) : (
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
        )}
      </main>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={d.deleteConfirm.title}
        description={fromApp ? d.deleteConfirm.textApp : d.deleteConfirm.text}
        confirmLabel={d.deleteConfirm.confirm}
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: row.id })}
      />
      {assigning ? <AssignDialog id={row.id} onClose={() => setAssigning(false)} /> : null}
      {addingContact ? (
        <PersonDialog
          initialEmail={row.email ?? undefined}
          onCreated={(created) => {
            link.mutate({ id: row.id, contactId: created.id });
            setAddingContact(false);
          }}
          onClose={() => setAddingContact(false)}
        />
      ) : null}
    </div>
  );
}

const s = sk.sharing.activity;

/** One step of a draft's trail in words, from what the audit event may hold. */
function trailLine(action: string, diff: Record<string, unknown> | null, names: string) {
  const e = s.events;
  if (action === 'publicShare.saveDraft') return s.saved(names);
  if (action === 'fileShare.decide') {
    const decision = diff?.decision;
    return decision === 'approved' || decision === 'rejected' || decision === 'pending'
      ? e.decision[decision]
      : null;
  }
  if (action === 'fileShare.reply') return e.reply;
  if (action === 'fileShare.agree') return diff?.agreed ? e.agreed : e.reopened;
  if (action === 'fileShare.merge') return e.merged;
  if (action === 'fileShare.discard') return e.discarded;
  if (action === 'fileShare.finish') {
    return typeof diff?.version === 'number' ? e.version(diff.version) : e.finished;
  }
  return null;
}

/** An activity from a public link: the draft as it is now, and what happened to it. */
function DocumentChange({
  id,
  createdAt,
  typeName,
}: {
  id: string;
  createdAt: Date | string;
  typeName: string;
}) {
  const change = useQuery(trpc.leadActivity.documentChange.queryOptions({ id }));
  const data = change.data;
  const states = sk.sharing.drafts.states;
  return (
    <main className="grid max-w-[1080px] items-start gap-5 px-7 pt-5 pb-10 md:grid-cols-2">
      <Card>
        <CardHeader title={d.what} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 pt-3 pb-5">
          <Field label={d.type}>
            <Badge tone="info" dot>
              {typeName}
            </Badge>
          </Field>
          <Field label={s.state}>
            {data
              ? data.versionNumber
                ? sk.sharing.drafts.version(data.versionNumber)
                : states[data.state]
              : sk.common.none}
          </Field>
          <Field label={d.createdAt}>{formatDateTime(createdAt)}</Field>
          <Field label={s.content}>
            {data ? sk.sharing.drafts.counts(data.changes, data.comments) : sk.common.none}
          </Field>
        </dl>
      </Card>
      <Card>
        <CardHeader title={d.who} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 pt-3 pb-5">
          <Field label={s.visitor}>{data?.authorNames.join(', ') ?? sk.common.none}</Field>
          <Field label={s.file}>{data?.fileName ?? sk.common.none}</Field>
        </dl>
        {data ? (
          <div className="px-5 pb-5">
            <Button asChild>
              <Link to="/files" search={{ file: data.fileId, draft: data.draftId }}>
                {s.openDraft}
              </Link>
            </Button>
          </div>
        ) : null}
      </Card>
      {data ? (
        <Card className="md:col-span-2">
          <CardHeader title={s.trail} />
          <ol className="px-5 pt-2 pb-5">
            {data.trail.flatMap((event, i) => {
              const line = trailLine(event.action, event.diff, data.authorNames.join(', '));
              if (!line) return [];
              return [
                <li
                  key={i}
                  className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle py-2.5 text-sm first:border-t-0"
                >
                  <span className="w-36 shrink-0 text-muted">{formatDateTime(event.at)}</span>
                  <span className="min-w-[14rem] flex-1">
                    {event.userName && event.action !== 'publicShare.saveDraft'
                      ? `${event.userName}: ${line}`
                      : line}
                  </span>
                </li>,
              ];
            })}
          </ol>
        </Card>
      ) : null}
    </main>
  );
}

/** The organization, or for a prevádzka its organization, or what Alma calls an unmatched one. */
function Organization({ row }: { row: Entry }) {
  if (!row.organizationId) {
    return (
      <>
        <span className="font-semibold text-warning">{t.unassigned}</span>
        {row.sourceOrganizationName ? (
          <span className="block text-xs text-muted">{t.inApp(row.sourceOrganizationName)}</span>
        ) : null}
      </>
    );
  }
  return (
    <>
      <Link
        to="/organizations/$customerId"
        params={{ customerId: row.parentId ?? row.organizationId }}
        className={LINK}
      >
        {row.parentName ?? row.organizationName}
      </Link>
      {row.organizationRole ? (
        <span className="block text-xs text-muted">{t.roles[row.organizationRole]}</span>
      ) : null}
    </>
  );
}

/** A record of the app's own steps: only its length is said, the rows open on a click. */
function Technical({ title, rows }: { title: string; rows: unknown[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mt-2 text-xs font-semibold text-muted">{title}</p>
      <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-track/50 p-2 text-[11px] leading-4 whitespace-pre-wrap">
        {rows.map((row) => JSON.stringify(row)).join('\n')}
      </pre>
    </div>
  );
}

/**
 * A podnet's text and picture, read apart from the entry: they may hold health data, and the read
 * is recorded (docs/activities-from-apps.md, section 6).
 */
function FeedbackContent({ id }: { id: string }) {
  const content = useQuery(trpc.leadActivity.feedback.queryOptions({ id }));
  const data = content.data;
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
  return (
    <Card className="md:col-span-2">
      <CardHeader title={d.feedback} />
      {loadFailed(content) ? (
        <div className="px-5 pb-5">
          <ErrorState onRetry={() => void content.refetch()} />
        </div>
      ) : !data ? (
        <p className="px-5 pt-3 pb-5 text-sm text-muted">{d.feedbackLoading}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 pt-3 pb-5">
          <Field label={d.whatDoing} className="col-span-2 whitespace-pre-wrap">
            {data.whatDoing}
          </Field>
          <Field label={d.expected} className="col-span-2 whitespace-pre-wrap">
            {data.expected || sk.common.none}
          </Field>
          <Field label={d.screen}>
            {text(data.place?.heading) ?? text(data.place?.screen) ?? sk.common.none}
          </Field>
          <Field label={d.marked}>{text(data.place?.element) ?? sk.common.none}</Field>
          {data.screenshotUrl ? (
            <Field label={d.screenshot} className="col-span-2">
              <img
                src={data.screenshotUrl}
                alt={d.screenshotAlt}
                className="mt-1 max-h-96 max-w-full rounded-lg border border-border-subtle"
              />
            </Field>
          ) : null}
          <Field label={d.device}>
            {[text(data.device.os), text(data.device.network)].filter(Boolean).join(' · ') ||
              sk.common.none}
          </Field>
          <Field label={d.fromApp}>
            {[clientOf(text(data.app.client)), text(data.app.version)]
              .filter(Boolean)
              .join(' · ') || sk.common.none}
          </Field>
          <details className="col-span-2 text-sm">
            <summary className={cn(LINK, 'cursor-pointer')}>
              {d.technical}:{' '}
              {d.technicalSummary(data.trail.length, data.apiCalls.length, data.errors.length)}
            </summary>
            <Technical title={d.technicalSteps} rows={data.trail} />
            <Technical title={d.technicalCalls} rows={data.apiCalls} />
            <Technical title={d.technicalErrors} rows={data.errors} />
          </details>
          {data.events.length > 0 ? (
            <Field label={d.events} className="col-span-2">
              <ul className="mt-1 space-y-2">
                {data.events.map((event) => (
                  <li key={event.id} className="whitespace-pre-wrap">
                    <span className="block text-xs text-muted">
                      {formatDateTime(event.sentAt)}
                      {event.works === null
                        ? ''
                        : ` · ${event.works ? d.eventWorks : d.eventStillNot}`}
                    </span>
                    {event.body}
                  </li>
                ))}
              </ul>
            </Field>
          ) : null}
        </dl>
      )}
    </Card>
  );
}

/** A podnet that matched nothing goes to an organization or a prevádzka by hand. */
function AssignDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);
  const [picked, setPicked] = useState<string | null>(null);
  const found = useQuery({
    ...trpc.customer.list.queryOptions({ search: term, pageSize: 8 }),
    enabled: term.length >= 2,
  });
  const assign = useMutation(
    trpc.leadActivity.assign.mutationOptions({
      onSuccess: async () => {
        toast('success', d.assignDone);
        await queryClient.invalidateQueries(trpc.leadActivity.pathFilter());
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const candidates = found.data?.items ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.assignTitle}</DialogTitle>
          <DialogDescription>{d.assignText}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            aria-label={d.assignSearch}
            placeholder={d.assignSearch}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {term.length >= 2 && found.isSuccess && candidates.length === 0 ? (
            <li className="px-1 text-sm text-muted">{d.assignNothing}</li>
          ) : null}
          {candidates.map((c) => (
            <li key={c.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5',
                  picked === c.id && 'border-primary bg-primary-soft/40',
                )}
              >
                <input
                  type="radio"
                  name="organization"
                  aria-label={c.name}
                  checked={picked === c.id}
                  onChange={() => setPicked(c.id)}
                  className="size-4 accent-[var(--color-primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{c.name}</span>
                  {c.city ? <span className="block text-xs text-muted">{c.city}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={!picked || assign.isPending}
            onClick={() => picked && assign.mutate({ id, organizationId: picked })}
          >
            {d.assign}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
