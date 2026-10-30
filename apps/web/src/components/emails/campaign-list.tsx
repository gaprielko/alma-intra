import { sk } from '@intra/shared/i18n';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { TablePagination, TableShell } from '@/components/table-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RowActions, RowLink, TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { trpc } from '@/lib/trpc';

const t = sk.campaigns.list;

/** Odoslané (with delivery counts) or Koncepty (to continue or delete): the newest first. */
export function CampaignList({ status }: { status: 'sent' | 'draft' }) {
  const [page, setPage] = useState(1);
  const hrefOf = (row: { id: string; kind: 'bulk' | 'direct' }) =>
    status === 'sent'
      ? `/emails/sent/${row.id}`
      : row.kind === 'direct'
        ? `/emails/new/${row.id}`
        : `/emails/compose/${row.id}`;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<{ id: string; subject: string } | null>(null);
  const remove = useMutation(
    trpc.campaign.deleteDraft.mutationOptions({
      onSuccess: async () => {
        toast('success', sk.campaigns.discardConfirm.done);
        setDeleting(null);
        await queryClient.invalidateQueries(trpc.campaign.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.campaigns.errors)),
    }),
  );
  const list = useQuery({
    ...trpc.campaign.list.queryOptions({ status, page }),
    placeholderData: keepPreviousData,
  });
  if (loadFailed(list)) return <ErrorState onRetry={() => void list.refetch()} />;
  const rows = list.data?.items ?? [];
  const sent = status === 'sent';
  if (list.data && rows.length === 0 && page === 1) {
    return <EmptyState title={sent ? t.emptySent : t.emptyDrafts} />;
  }
  const c = t.columns;
  return (
    <>
      <TableShell
        columns={
          sent
            ? [c.subject, c.sender, c.when, c.recipients, c.delivered, c.bounced]
            : [
                c.subject,
                c.recipients,
                c.updated,
                <span key="a" className="sr-only">
                  {sk.common.actions}
                </span>,
              ]
        }
        loading={list.isPending}
        refreshing={list.isPlaceholderData}
        footer={
          <TablePagination page={page} total={list.data?.total ?? 0} onPageChange={setPage} />
        }
      >
        {rows.map((row) => (
          <TableRow key={row.id} href={hrefOf(row)}>
            <TableCell>
              <RowLink href={hrefOf(row)} className="font-semibold">
                {row.subjectText || t.noSubject}
              </RowLink>
              {row.templateName ? <p className="text-xs text-muted">{row.templateName}</p> : null}
            </TableCell>
            {sent ? (
              <>
                <TableCell className="text-muted">{row.senderName}</TableCell>
                <TableCell className="text-muted">
                  {row.status === 'sending' ? (
                    <Badge tone="info" dot>
                      {t.sending}
                    </Badge>
                  ) : row.status === 'scheduled' && row.sentAt ? (
                    <Badge tone="info" dot>
                      {t.scheduled(formatDateTime(row.sentAt))}
                    </Badge>
                  ) : row.sentAt ? (
                    formatDateTime(row.sentAt)
                  ) : (
                    sk.common.none
                  )}
                </TableCell>
                <TableCell>{row.recipients}</TableCell>
                <TableCell>{row.delivered}</TableCell>
                <TableCell className={row.bounced > 0 ? 'font-semibold text-danger' : undefined}>
                  {row.bounced}
                </TableCell>
              </>
            ) : (
              <>
                <TableCell>{row.recipients + row.skipped}</TableCell>
                <TableCell className="text-muted">{formatRecent(row.updatedAt)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <span className="text-sm font-semibold text-primary-text">{t.continue}</span>
                  <RowActions className="ml-2 inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t.deleteDraft(row.subjectText || t.noSubject)}
                      onClick={() =>
                        setDeleting({ id: row.id, subject: row.subjectText || t.noSubject })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </RowActions>
                </TableCell>
              </>
            )}
          </TableRow>
        ))}
      </TableShell>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={sk.campaigns.discardConfirm.title}
        description={`${deleting?.subject ?? ''}. ${sk.campaigns.discardConfirm.text}`}
        confirmLabel={sk.campaigns.discardConfirm.confirm}
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </>
  );
}
