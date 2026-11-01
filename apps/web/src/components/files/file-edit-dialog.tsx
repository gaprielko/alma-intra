import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FileBadge } from '@/components/files/file-bits';
import { type DocApi, DocWorkspace, type SaveOp } from '@/components/share/doc-workspace';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { trpc, trpcClient } from '@/lib/trpc';

const t = sk.sharing;

/**
 * A colleague editing an HTML file in Súbory, the same way as on a public link, in the same isolated
 * frame. They choose: a new version at once, or a draft; a comment written here leaves only the
 * draft, since it waits for an answer.
 */
export function FileEditDialog({
  file,
  onClose,
  onBack,
}: {
  file: { id: string; name: string; folderPath?: string | null; folderName?: string };
  onClose: () => void;
  /** „Späť na náhľad“. */
  onBack: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sessionId] = useState(() => crypto.randomUUID());
  const info = useQuery({
    ...trpc.fileShare.editInfo.queryOptions({ fileId: file.id }),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [unfit, setUnfit] = useState<string | null>(null);
  const api = useMemo<DocApi>(
    () => ({
      key: ['file-edit-comments', file.id, sessionId],
      comments: () => trpcClient.fileShare.editComments.query({ fileId: file.id, sessionId }),
      addComment: (input) =>
        trpcClient.fileShare.addComment.mutate({ fileId: file.id, sessionId, ...input }),
      editComment: (id, body) => trpcClient.fileShare.editComment.mutate({ id, body }),
      deleteComment: (id) => trpcClient.fileShare.deleteComment.mutate({ id }),
      fragment: (block) => trpcClient.fileShare.editFragment.query({ fileId: file.id, block }),
    }),
    [file.id, sessionId],
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.file.pathFilter()),
      queryClient.invalidateQueries(trpc.fileShare.drafts.pathFilter()),
    ]);
  const save = useMutation({
    mutationFn: (input: { mode: 'version' | 'draft'; ops: SaveOp[]; onDraft: () => void }) =>
      trpcClient.fileShare.saveEdits.mutate({
        fileId: file.id,
        sessionId,
        baseVersionId: info.data!.versionId,
        mode: input.mode,
        ops: input.ops,
      }),
    onSuccess: async (result, input) => {
      if (result.kind === 'unfit') {
        setUnfit(t.edit.unfit(result.version, result.count));
        return;
      }
      setUnfit(null);
      await refresh();
      if (result.kind === 'version') {
        toast('success', t.edit.versionMade(result.number));
        onBack();
      } else {
        input.onDraft();
      }
    },
    onError: (error) => toast('error', errorMessage(error, t.errors)),
  });
  /** Leaving with something unsaved asks first. */
  const leave = (go: () => void) => {
    if (dirty) setLeaving(() => go);
    else go();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : leave(onClose))}>
      <DialogContent
        size="lg"
        className="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none gap-0 overflow-hidden rounded-2xl p-0"
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle py-3.5 pr-16 pl-5">
          <FileBadge name={file.name} />
          <div className="min-w-0 flex-[1_1_15rem]">
            <DialogTitle className="text-base break-words">{file.name}</DialogTitle>
            <DialogDescription>{file.folderPath ?? file.folderName ?? ''}</DialogDescription>
          </div>
          <Button variant="secondary" onClick={() => leave(onBack)}>
            {t.edit.back}
          </Button>
        </header>
        {unfit ? (
          <div role="alert" className="bg-warning-soft px-5 py-2.5 text-sm text-warning">
            {unfit}
          </div>
        ) : null}
        {info.data ? (
          <DocWorkspace
            frame={info.data.frame}
            title={file.name}
            api={api}
            canComment
            canEdit={info.data.canEdit}
            savedText={t.edit.draftSaved}
            onChange={setDirty}
            bar={({ unsaved, ops, wroteComment, discard, markSaved }) => (
              <div
                role="status"
                className="flex flex-wrap items-center gap-3 bg-sidebar px-5 py-2.5 text-sm text-white"
              >
                <p className="min-w-0 flex-[1_1_12rem] font-semibold">{t.bar.unsaved(unsaved)}</p>
                <Button variant="secondary" onClick={discard}>
                  {t.bar.discard}
                </Button>
                <Button
                  variant="secondary"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ mode: 'draft', ops, onDraft: markSaved })}
                >
                  {t.edit.saveDraft}
                </Button>
                <Button
                  disabled={save.isPending || wroteComment}
                  aria-describedby={wroteComment ? 'only-draft' : undefined}
                  onClick={() => save.mutate({ mode: 'version', ops, onDraft: markSaved })}
                >
                  {t.edit.saveVersion}
                </Button>
                {wroteComment ? (
                  <p id="only-draft" className="w-full text-[13px] text-[#d7f2ef]">
                    {t.edit.onlyDraft}
                  </p>
                ) : null}
              </div>
            )}
          />
        ) : null}
      </DialogContent>
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => (open ? null : setLeaving(null))}
        title={t.edit.leave.title}
        description={t.edit.leave.text}
        confirmLabel={t.edit.leave.confirm}
        destructive
        onConfirm={() => {
          const go = leaving;
          setLeaving(null);
          setDirty(false);
          go?.();
        }}
      />
    </Dialog>
  );
}
