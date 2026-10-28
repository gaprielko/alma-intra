import * as DialogPrimitive from '@radix-ui/react-dialog';
import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Download, Eye, Mail, MoreHorizontal, Upload } from 'lucide-react';
import { useState } from 'react';
import { KindMark } from '@/components/activities/activity-bits';
import { ChangedBy, FileBadge } from '@/components/files/file-bits';
import { type FilesDialog, FilesDialogs } from '@/components/files/file-dialogs';
import { ErrorState } from '@/components/empty-state';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { canPreview, formatSize } from '@/lib/files';
import { formatDate, formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { downloadFile, previewFile } from '@/lib/uploads';
import { cn } from '@/lib/utils';

const t = sk.files;
const d = t.detail;
type Detail = RouterOutputs['file']['get'];

/** A file's side sheet: where it is, who made it, its versions and its history. */
export function FileSheet({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const file = useQuery(trpc.file.get.queryOptions({ id: fileId }));
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[min(37.5rem,100vw)] gap-0 p-0" aria-describedby={undefined}>
        {file.isPending ? (
          <>
            <DialogPrimitive.Title className="sr-only">{sk.common.loading}</DialogPrimitive.Title>
            <div className="p-6">
              <CardSkeleton lines={6} />
            </div>
          </>
        ) : loadFailed(file) ? (
          <>
            <DialogPrimitive.Title className="sr-only">{sk.errors.pageTitle}</DialogPrimitive.Title>
            <ErrorState
              text={errorMessage(file.error, t.errors)}
              onRetry={() => void file.refetch()}
            />
          </>
        ) : (
          <SheetBody file={file.data} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ file, onClose }: { file: Detail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCan('file.write');
  const canDelete = useCan('file.delete');
  const [tab, setTab] = useState<'versions' | 'usage' | 'history'>('versions');
  const usage = useQuery(trpc.activity.fileUsage.queryOptions({ fileId: file.id }));
  const [dialog, setDialog] = useState<FilesDialog | null>(null);
  const current = file.versions[0];
  const ref = {
    id: file.id,
    name: file.name,
    folderId: file.folderId,
    description: file.description,
  };
  const folderLink = (folderId: string) =>
    ({ to: '/files', search: { folder: folderId } }) as const;

  const trash = useMutation(
    trpc.file.trashFile.mutationOptions({
      onSuccess: async () => {
        onClose();
        await queryClient.invalidateQueries(trpc.file.pathFilter());
        toast('success', t.trash.trashed, {
          label: t.trash.undo,
          run: async () => {
            await restore.mutateAsync({ id: file.id });
          },
        });
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const restore = useMutation(
    trpc.file.restoreFile.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.file.pathFilter()),
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const download = (versionId?: string) =>
    void downloadFile(file.id, file.name, versionId).catch((error: unknown) =>
      toast('error', errorMessage(error, t.errors)),
    );
  const preview = (versionId?: string) =>
    void previewFile(file.id, versionId).catch((error: unknown) =>
      toast('error', errorMessage(error, t.errors)),
    );

  return (
    <div className="flex flex-col">
      <header className="flex items-start gap-3.5 px-6 pt-6 pr-16">
        <FileBadge name={file.name} large />
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-xl leading-[26px] font-bold break-words">
            {file.name}
          </DialogPrimitive.Title>
          <p className="mt-0.5 text-[13px] text-muted">
            {file.path.map((step, i) => (
              <span key={step.id}>
                {i > 0 ? ' / ' : null}
                <Link
                  {...folderLink(step.id)}
                  className="text-primary-text hover:underline"
                  onClick={onClose}
                >
                  {step.name}
                </Link>
              </span>
            ))}
            {current ? ` · ${formatSize(current.size)} · ${d.version(current.number!)}` : null}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 px-6 pt-4">
        <Button onClick={() => download()}>
          <Download className="size-4" aria-hidden />
          {d.download}
        </Button>
        {canPreview(file.name) ? (
          <Button variant="secondary" onClick={() => preview()}>
            <Eye className="size-4" aria-hidden />
            {d.preview}
          </Button>
        ) : null}
        {canWrite ? (
          <Button variant="secondary" onClick={() => setDialog({ kind: 'version', file: ref })}>
            <Upload className="size-4" aria-hidden />
            {t.menu.newVersion}
          </Button>
        ) : null}
        {canWrite || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="size-10" aria-label={t.actionsFor(file.name)}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canWrite ? (
                <>
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'renameFile', file: ref })}>
                    {t.menu.rename}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'moveFile', file: ref })}>
                    {t.menu.move}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'describe', file: ref })}>
                    {t.menu.describe}
                  </DropdownMenuItem>
                </>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => trash.mutate({ id: file.id })}>
                    {t.menu.trash}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <dl className="mx-6 mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-[14px] border border-border-subtle bg-surface p-4">
        <div>
          <dt className="text-xs font-medium text-muted">{d.createdBy}</dt>
          <dd className="mt-0.5 text-sm">
            {[file.createdBy, formatDate(file.createdAt)].filter(Boolean).join(' · ')}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">{d.changedBy}</dt>
          <dd className="mt-0.5 text-sm">
            {current ? <ChangedBy name={current.createdBy} via={current.createdVia} /> : null}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs font-medium text-muted">{d.description}</dt>
          <dd
            className={cn('mt-0.5 text-sm whitespace-pre-line', !file.description && 'text-muted')}
          >
            {file.description ?? d.noDescription}
          </dd>
        </div>
      </dl>

      <div
        role="tablist"
        aria-label={d.tabs.label}
        className="mt-5 flex gap-5 border-b border-border-subtle px-6"
      >
        {(['versions', 'usage', 'history'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'h-9 border-b-2 px-1 text-sm font-semibold transition-colors',
              tab === key
                ? 'border-primary text-primary-text'
                : 'border-transparent text-muted hover:text-foreground',
            )}
          >
            {key === 'versions'
              ? d.tabs.versions(file.versions.length)
              : key === 'usage'
                ? d.tabs.usage(usage.data?.length ?? 0)
                : d.tabs.history}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="px-6 pt-1 pb-6">
        {tab === 'versions' ? (
          <Versions file={file} canWrite={canWrite} onDownload={download} onPreview={preview} />
        ) : tab === 'usage' ? (
          <Usage rows={usage.data ?? []} />
        ) : (
          <History fileId={file.id} />
        )}
      </div>

      <FilesDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function Versions({
  file,
  canWrite,
  onDownload,
  onPreview,
}: {
  file: Detail;
  canWrite: boolean;
  onDownload: (versionId: string) => void;
  onPreview: (versionId: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const restore = useMutation(
    trpc.file.restoreVersion.mutationOptions({
      onSuccess: async (result) => {
        toast('success', d.restoreDone(result.restoredFrom));
        await queryClient.invalidateQueries(trpc.file.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const previewable = canPreview(file.name);
  return (
    <ul>
      {file.versions.map((version, i) => {
        const isCurrent = version.id === file.currentVersionId;
        return (
          <li
            key={version.id}
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3',
              i > 0 && 'border-t border-border-subtle',
            )}
          >
            <span
              className={cn(
                'inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border text-xs font-bold',
                isCurrent
                  ? 'border-[#bfe2df] bg-primary-soft text-primary-text'
                  : 'border-border-subtle bg-surface text-muted',
              )}
            >
              v{version.number}
            </span>
            <div className="min-w-[13rem] flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <ChangedBy name={version.createdBy} via={version.createdVia} />
                {isCurrent ? <Badge tone="info">{d.current}</Badge> : null}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {[
                  formatDateTime(version.createdAt),
                  formatSize(version.size),
                  version.restoredFrom ? d.restoredFrom(version.restoredFrom) : null,
                  version.note ? `„${version.note}“` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            {previewable ? (
              <Button variant="ghost" size="sm" onClick={() => onPreview(version.id)}>
                {d.preview}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => onDownload(version.id)}>
              {d.download}
            </Button>
            {canWrite && !isCurrent ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={restore.isPending}
                onClick={() => restore.mutate({ versionId: version.id })}
              >
                {d.restore}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const h = d.history;

/** One line per audit event of the file. */
function describeEvent(action: string, diff: Record<string, unknown> | null): string {
  const name = action.split('.').at(-1) ?? '';
  switch (name) {
    case 'download':
      return diff?.inline === true ? h.preview : h.download;
    case 'confirmUpload':
      return h.confirmUpload(Number(diff?.version ?? 0));
    case 'restoreVersion':
      return h.restoreVersion(Number(diff?.restoredFrom ?? 0));
    case 'requestUpload':
    case 'requestVersion':
    case 'rename':
    case 'describe':
    case 'move':
    case 'trashFile':
    case 'restoreFile':
      return h[name];
    default:
      return h.other;
  }
}

/** „Kde je použitý“: the activities that keep a version of this file and the e-mails that carried one. */
function Usage({ rows }: { rows: RouterOutputs['activity']['fileUsage'] }) {
  if (rows.length === 0) return <p className="py-6 text-sm text-muted">{d.usageEmpty}</p>;
  return (
    <ul className="space-y-2 pt-3">
      {rows.map((row) =>
        row.type === 'email' ? (
          <li key={`e-${row.campaignId}`}>
            <Link
              to="/emails/sent/$campaignId"
              params={{ campaignId: row.campaignId }}
              className="flex items-center gap-3 rounded-xl border border-border-subtle px-3.5 py-3 hover:bg-hover"
            >
              <Mail className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {d.usageEmail(row.subject ?? '')}
                </span>
                <span className="block truncate text-[13px] text-muted">
                  {d.usageEmailMeta(row.recipients, row.version, formatDate(row.sentAt))}
                </span>
              </span>
            </Link>
          </li>
        ) : (
          <li key={row.activityId}>
            <Link
              to="/customers/$customerId"
              params={{ customerId: row.customerId }}
              className="flex items-center gap-3 rounded-xl border border-border-subtle px-3.5 py-3 hover:bg-hover"
            >
              <KindMark kind={row.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {d.usageItem(sk.activities.kinds[row.kind], row.subject ?? '')}
                </span>
                <span className="block truncate text-[13px] text-muted">
                  {d.usageMeta(row.customerName, row.version, formatDate(row.occurredAt))}
                </span>
              </span>
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

function History({ fileId }: { fileId: string }) {
  const history = useQuery(trpc.file.history.queryOptions({ id: fileId }));
  if (history.isPending) return <CardSkeleton lines={4} className="mt-3 border-0 shadow-none" />;
  if (loadFailed(history)) {
    return (
      <ErrorState
        compact
        text={errorMessage(history.error)}
        onRetry={() => void history.refetch()}
      />
    );
  }
  // The upload's request and its confirmation are one step to a reader: the confirmation says it.
  const events = history.data.filter(
    (event) =>
      !event.action.endsWith('.requestUpload') && !event.action.endsWith('.requestVersion'),
  );
  if (events.length === 0) return <p className="py-6 text-sm text-muted">{d.emptyHistory}</p>;
  return (
    <ol>
      {events.map((event, i) => (
        <li key={event.id} className={cn('py-2.5', i > 0 && 'border-t border-border-subtle')}>
          <p className="text-sm font-medium">{describeEvent(event.action, event.diff)}</p>
          <p className="text-[13px] text-muted">
            {h.by(event.userName ?? sk.common.none, formatDateTime(event.at))}
          </p>
        </li>
      ))}
    </ol>
  );
}
