import * as DialogPrimitive from '@radix-ui/react-dialog';
import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { formatDay, KindMark } from '@/components/activities/activity-bits';
import { ActivityDialog } from '@/components/activities/activity-dialog';
import { ErrorState } from '@/components/empty-state';
import { FileBadge } from '@/components/files/file-bits';
import { RichTextView } from '@/components/rich-text';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { canPreview, formatSize } from '@/lib/files';
import { formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc, trpcClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.activities;
const d = t.detail;
type Activity = RouterOutputs['activity']['get'];

/** The activity's side sheet: what happened, the next step, who, the notes, files, history. */
export function ActivitySheet({
  activityId,
  onClose,
}: {
  activityId: string;
  onClose: () => void;
}) {
  const activity = useQuery(trpc.activity.get.queryOptions({ id: activityId }));
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[min(37.5rem,100vw)] gap-0 p-0" aria-describedby={undefined}>
        {activity.isPending ? (
          <>
            <DialogPrimitive.Title className="sr-only">{sk.common.loading}</DialogPrimitive.Title>
            <div className="p-6">
              <CardSkeleton lines={6} />
            </div>
          </>
        ) : loadFailed(activity) ? (
          <>
            <DialogPrimitive.Title className="sr-only">{sk.errors.pageTitle}</DialogPrimitive.Title>
            <ErrorState
              text={errorMessage(activity.error, t.errors)}
              onRetry={() => void activity.refetch()}
            />
          </>
        ) : (
          <Body activity={activity.data} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A saved attachment through the activity: the version it keeps, even replaced or trashed. */
async function openAttachment(
  activityId: string,
  versionId: string,
  name: string,
  inline: boolean,
) {
  const tab = inline ? window.open('', '_blank') : null;
  try {
    const { url } = await trpcClient.activity.attachmentUrl.mutate({
      activityId,
      versionId,
      inline,
    });
    if (inline) {
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
      return;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}

function Body({ activity: a, onClose }: { activity: Activity; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCan('activity.write');
  const canDelete = useCan('activity.delete');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const history = useQuery(trpc.activity.history.queryOptions({ id: a.id }));
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.activity.pathFilter()),
      queryClient.invalidateQueries(trpc.customer.list.pathFilter()),
    ]);

  const done = useMutation(
    trpc.activity.setNextStepDone.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const remove = useMutation(
    trpc.activity.delete.mutationOptions({
      onSuccess: async () => {
        toast('success', d.deleteConfirm.done);
        await refresh();
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );

  const meta = [
    formatDateTime(a.occurredAt),
    a.durationMin ? t.duration.format(a.durationMin) : null,
    a.author ? d.by(a.author) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-start gap-3.5 px-6 pt-6 pr-16">
        <KindMark kind={a.kind} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-muted">
            {t.kinds[a.kind]} ·{' '}
            <Link
              to="/customers/$customerId"
              params={{ customerId: a.customerId }}
              className="text-primary-text hover:underline"
              onClick={onClose}
            >
              {a.customerName}
            </Link>
          </p>
          <DialogPrimitive.Title className="text-xl leading-[26px] font-bold break-words">
            {a.subject ?? t.kinds[a.kind]}
          </DialogPrimitive.Title>
          <p className="mt-0.5 text-[13px] text-muted">{meta}</p>
        </div>
      </header>

      <div className="flex-1 space-y-5 px-6 pt-5 pb-6">
        {a.nextStepText ? (
          <section
            className={cn(
              'rounded-[14px] border p-4',
              a.nextStepDoneAt
                ? 'border-border-subtle bg-surface'
                : 'border-[#bfe2df] bg-[#f0f8f7]',
            )}
          >
            <p className="text-xs font-semibold tracking-[0.06em] text-tertiary uppercase">
              {d.nextStep}
              {a.nextStepDue ? ` · ${d.nextStepDue(formatDay(a.nextStepDue))}` : ''}
            </p>
            <p
              className={cn(
                'mt-1 text-sm font-semibold',
                a.nextStepDoneAt && 'line-through opacity-70',
              )}
            >
              {a.nextStepText}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-muted">
                {a.nextStepDoneAt
                  ? d.doneBy(a.nextStepDoneBy ?? sk.common.none, formatDateTime(a.nextStepDoneAt))
                  : (a.nextStepUser ?? sk.common.none)}
              </p>
              {canWrite ? (
                <Button
                  size="sm"
                  variant={a.nextStepDoneAt ? 'ghost' : 'secondary'}
                  disabled={done.isPending}
                  onClick={() => done.mutate({ id: a.id, done: !a.nextStepDoneAt })}
                >
                  {a.nextStepDoneAt ? (
                    d.reopen
                  ) : (
                    <>
                      <Check className="size-3.5" aria-hidden />
                      {d.done}
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {a.participants.length > 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-tertiary uppercase">
              {d.participants}
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {a.participants.map((person) => (
                <li
                  key={`${person.kind}:${person.id}`}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[13px] font-semibold',
                    person.kind === 'user'
                      ? 'bg-[#dde6e3] text-muted'
                      : 'bg-primary-soft text-primary-text',
                  )}
                >
                  {person.name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-tertiary uppercase">
            {d.notes}
          </h3>
          {a.body ? (
            <RichTextView value={a.body} />
          ) : (
            <p className="text-sm text-muted">{d.noNotes}</p>
          )}
        </section>

        {a.attachments.length > 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-tertiary uppercase">
              {d.attachments}
            </h3>
            <ul className="space-y-1.5">
              {a.attachments.map((file) => {
                const run = (inline: boolean) =>
                  void openAttachment(a.id, file.versionId, file.name, inline).catch(
                    (error: unknown) => toast('error', errorMessage(error, sk.files.errors)),
                  );
                return (
                  <li
                    key={file.versionId}
                    className="flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2"
                  >
                    <FileBadge name={file.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{file.name}</span>
                      <span className="block text-xs text-muted">
                        {[
                          d.attachmentVersion(file.number ?? 1, file.current),
                          formatSize(file.size),
                          file.trashed ? d.trashed : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {canPreview(file.name) ? (
                      <Button variant="ghost" size="sm" onClick={() => run(true)}>
                        {sk.files.detail.preview}
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => run(false)}>
                      {sk.files.detail.download}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-tertiary uppercase">
            {d.history}
          </h3>
          <ol className="space-y-1.5">
            {(history.data ?? []).map((event) => {
              const name = event.action.split('.').at(-1) ?? '';
              const label =
                name in d.historyItem
                  ? d.historyItem[name as keyof typeof d.historyItem]
                  : d.historyItem.other;
              return (
                <li key={event.id} className="text-[13px] text-muted">
                  {formatDateTime(event.at)} · {event.userName ?? sk.common.none} · {label}
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      {canWrite || canDelete ? (
        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-border-subtle bg-white px-6 py-4">
          {canDelete ? (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={() => setDeleting(true)}
            >
              {d.delete}
            </Button>
          ) : null}
          {canWrite ? <Button onClick={() => setEditing(true)}>{d.edit}</Button> : null}
        </footer>
      ) : null}

      {editing ? (
        <ActivityDialog
          customerId={a.customerId}
          customerName={a.customerName}
          activity={a}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={d.deleteConfirm.title}
        description={d.deleteConfirm.text}
        confirmLabel={d.deleteConfirm.confirm}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: a.id })}
      />
    </div>
  );
}
