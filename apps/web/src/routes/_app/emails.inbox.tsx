import { sk } from '@intra/shared/i18n';
import { INBOUND_VIEWS } from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Paperclip, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { NewEmailButton } from '@/components/emails/new-email-button';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { TablePagination, TableShell } from '@/components/table-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RowLink, TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.inbound;

/** How often an open „Prijaté“ asks for new e-mail on its own. */
const REFRESH_MS = 30_000;

export const Route = createFileRoute('/_app/emails/inbox')({
  validateSearch: z.object({ view: z.enum(INBOUND_VIEWS).optional() }),
  component: InboxPage,
});

/** „Prijaté“: received e-mail, all of it first, „Nepriradené“ a click away; one opens on its own page. */
function InboxPage() {
  const { view = 'all' } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [page, setPage] = useState(1);
  const list = useQuery({
    ...trpc.inbound.list.queryOptions({ view, page }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const rows = list.data?.items ?? [];
  const toast = useToast();
  const queryClient = useQueryClient();
  const sync = useMutation(
    trpc.inbound.sync.mutationOptions({
      onSuccess: async ({ added }) => {
        toast('success', t.synced(added));
        await queryClient.invalidateQueries(trpc.inbound.pathFilter());
      },
      onError: (error) =>
        toast(
          'error',
          errorMessage(error, {
            not_configured: t.syncNotConfigured,
            provider_refused: t.syncRefused,
          }),
        ),
    }),
  );
  // Every 30 s, while the page is in view, take in what the webhook may have missed, quietly:
  // only new e-mails are told, a failure waits for the next round or „Načítať nové“.
  const autoSync = useMutation(
    trpc.inbound.sync.mutationOptions({
      onSuccess: async ({ added }) => {
        if (added === 0) return;
        toast('success', t.synced(added));
        await queryClient.invalidateQueries(trpc.inbound.pathFilter());
      },
    }),
  );
  const { mutate: syncQuietly } = autoSync;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') syncQuietly();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [syncQuietly]);
  const chip = (key: (typeof INBOUND_VIEWS)[number], label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={view === key}
      onClick={() => {
        setPage(1);
        void navigate({ search: { view: key === 'all' ? undefined : key } });
      }}
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
        view === key
          ? 'border-primary bg-primary-soft font-semibold text-primary-text'
          : 'border-border bg-white hover:bg-hover',
      )}
    >
      {label}
    </button>
  );
  return (
    <main className="max-w-[1440px] space-y-4 px-7 pt-5 pb-10">
      <div className="flex items-center gap-2">
        <div role="group" aria-label={t.views.label} className="flex gap-2">
          {chip('all', t.views.all)}
          {chip('unassigned', t.views.unassigned(list.data?.unassigned ?? 0))}
        </div>
        <span className="ml-auto" />
        <NewEmailButton size="sm" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={cn('size-3.5', sync.isPending && 'animate-spin')} aria-hidden />
          {t.sync}
        </Button>
      </div>
      {loadFailed(list) ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : list.data && rows.length === 0 && page === 1 ? (
        <EmptyState title={view === 'unassigned' ? t.emptyUnassigned : t.emptyAll} />
      ) : (
        <TableShell
          columns={[t.columns.from, t.columns.subject, t.columns.contact, t.columns.received]}
          columnClassNames={[undefined, undefined, 'hidden lg:table-cell', undefined]}
          loading={list.isPending}
          refreshing={list.isPlaceholderData}
          footer={
            <TablePagination page={page} total={list.data?.total ?? 0} onPageChange={setPage} />
          }
        >
          {rows.map((row) => (
            <TableRow key={row.id} href={`/emails/inbox/${row.id}`}>
              <TableCell className="max-w-56">
                {/* Filed under a person: their name from Kontakty, the address under it. */}
                <RowLink href={`/emails/inbox/${row.id}`} className="block truncate font-semibold">
                  {row.contactName || row.fromName || row.fromEmail}
                </RowLink>
                {row.contactName || row.fromName ? (
                  <p className="truncate text-xs text-muted">{row.fromEmail}</p>
                ) : null}
              </TableCell>
              <TableCell className="max-w-[28rem]">
                <p className="truncate text-sm font-medium">{row.subject || t.noSubject}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                  {row.attachmentCount > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5">
                      <Paperclip className="size-3" aria-hidden />
                      {t.attachments(row.attachmentCount)}
                    </span>
                  ) : null}
                  <span className="truncate">{row.preview}</span>
                </p>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {row.status === 'unassigned' ? (
                  <Badge tone="warning" dot>
                    {t.unassigned}
                  </Badge>
                ) : (
                  <span className="text-sm">{row.customerName}</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted">
                {formatRecent(row.receivedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableShell>
      )}
    </main>
  );
}
