import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { FILES_REFRESH_MS } from '@/lib/files';
import { formatDateTime } from '@/lib/format';
import { trpc } from '@/lib/trpc';

const t = sk.sharing.drafts;

/** „Koncepty“ of a file: the newest first, those waiting can be selected and merged. */
export function FileDrafts({ fileId }: { fileId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const drafts = useQuery({
    ...trpc.fileShare.drafts.queryOptions({ fileId }),
    refetchInterval: FILES_REFRESH_MS,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.fileShare.pathFilter()),
      queryClient.invalidateQueries(trpc.file.pathFilter()),
    ]);
  const merge = useMutation(
    trpc.fileShare.merge.mutationOptions({
      onSuccess: async () => {
        toast('success', t.merged);
        setSelected([]);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error, sk.sharing.errors)),
    }),
  );
  const discard = useMutation(
    trpc.fileShare.discard.mutationOptions({
      onSuccess: async () => {
        toast('success', t.discarded);
        setDiscarding(null);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error, sk.sharing.errors)),
    }),
  );
  const rows = drafts.data ?? [];
  if (drafts.data && rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{t.empty}</p>;
  }
  return (
    <div>
      {selected.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3 py-3">
          <p className="min-w-[14rem] flex-1 text-sm text-muted">{t.selected(selected.length)}</p>
          <Button
            disabled={merge.isPending}
            onClick={() => merge.mutate({ fileId, ids: selected })}
          >
            {t.merge}
          </Button>
        </div>
      ) : null}
      <ul>
        {rows.map((draft, i) => {
          const waiting = draft.state === 'waiting';
          const names = draft.authorNames.join(', ');
          const left = draft.pendingChanges + draft.openComments;
          return (
            <li
              key={draft.id}
              className={`flex items-start gap-3 py-3 ${i > 0 ? 'border-t border-border-subtle' : ''}`}
            >
              {waiting ? (
                <Checkbox
                  aria-label={t.select(names)}
                  checked={selected.includes(draft.id)}
                  className="mt-0.5"
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((now) =>
                      checked ? [...now, draft.id] : now.filter((id) => id !== draft.id),
                    );
                  }}
                />
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold break-words">{names}</p>
                <p className="mt-0.5 mb-1.5 text-[13px] text-muted">
                  {t.line(
                    formatDateTime(draft.createdAt),
                    draft.baseNumber ?? 0,
                    t.counts(draft.changes, draft.comments),
                  )}
                </p>
                <Badge
                  tone={waiting ? 'warning' : draft.state === 'finished' ? 'success' : 'neutral'}
                >
                  {draft.versionNumber
                    ? t.version(draft.versionNumber)
                    : waiting && draft.changes === 0
                      ? t.states.comments
                      : t.states[draft.state]}
                </Badge>{' '}
                {waiting ? <span className="text-[13px] text-muted">{t.left(left)}</span> : null}
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link from="/files" to="/files" search={(prev) => ({ ...prev, draft: draft.id })}>
                  {t.open}
                </Link>
              </Button>
              {waiting ? (
                <Button variant="ghost" size="sm" onClick={() => setDiscarding(draft.id)}>
                  {t.discard}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => (open ? null : setDiscarding(null))}
        title={t.discardConfirm.title}
        description={t.discardConfirm.text}
        confirmLabel={t.discardConfirm.confirm}
        destructive
        pending={discard.isPending}
        onConfirm={() => discarding && discard.mutate({ id: discarding })}
      />
    </div>
  );
}
