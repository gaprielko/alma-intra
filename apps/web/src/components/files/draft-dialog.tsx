import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FileBadge } from '@/components/files/file-bits';
import { CommentCard, CommentForm } from '@/components/share/comment-list';
import { DiffText } from '@/components/share/diff-text';
import { type BridgeMessage, DocFrame } from '@/components/share/doc-frame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { htmlText } from '@/lib/word-diff';

const t = sk.sharing.draft;
const c = sk.sharing.comments;

type Detail = RouterOutputs['fileShare']['draft'];
type Change = Detail['changes'][number];

function Heading({ children }: { children: string }) {
  return (
    <p className="px-1 pt-3 pb-1.5 text-xs font-semibold tracking-[0.06em] text-tertiary uppercase">
      {children}
    </p>
  );
}

/**
 * A draft over the page: the document as it would be, its changes to approve or reject, its comments
 * to answer and agree to. A new version only when all of it is settled.
 */
export function DraftDialog({
  id,
  onOpen,
  onClose,
}: {
  id: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const draft = useQuery(trpc.fileShare.draft.queryOptions({ id }));
  const send = useRef<((message: Record<string, unknown>) => void) | null>(null);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [replying, setReplying] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const data = draft.data;

  // The frame shows the document with what is not rejected: a new address only when that changes,
  // so an answer to a comment does not reload it and lose the place.
  const shown = (data?.changes ?? []).map((change) => `${change.id}:${change.decision}`).join();
  const frameSrc = useRef<{ key: string; src: string } | null>(null);
  if (data && frameSrc.current?.key !== `${id}|${shown}`) {
    frameSrc.current = { key: `${id}|${shown}`, src: data.frame };
  }

  const commentsForFrame = (data?.comments ?? [])
    .filter((comment) => !comment.agreedAt)
    .map((comment) => ({
      id: comment.id,
      anchor: comment.anchor,
      sameVersion: comment.sameVersion,
    }));
  const commentsKey = JSON.stringify(commentsForFrame.map((comment) => comment.id));
  const ready = useRef(false);
  useEffect(() => {
    if (ready.current) send.current?.({ type: 'comments', list: commentsForFrame });
    // Only when the set changes.
  }, [commentsKey]);

  const onMessage = (message: BridgeMessage) => {
    if (message.type === 'ready') {
      ready.current = true;
      send.current?.({ type: 'comments', list: commentsForFrame });
    } else if (message.type === 'comments-placed') {
      setUnplaced(message.unplaced);
    } else if (message.type === 'comment-click') {
      setSelected(message.id);
    }
  };

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.fileShare.pathFilter()),
      queryClient.invalidateQueries(trpc.file.pathFilter()),
      queryClient.invalidateQueries(trpc.leadActivity.pathFilter()),
    ]);
  const failed = (error: unknown) => toast('error', errorMessage(error, sk.sharing.errors));
  const decide = useMutation(
    trpc.fileShare.decide.mutationOptions({ onSuccess: refresh, onError: failed }),
  );
  const reply = useMutation(
    trpc.fileShare.reply.mutationOptions({
      onSuccess: async () => {
        setReplying(null);
        await refresh();
      },
      onError: failed,
    }),
  );
  const agree = useMutation(
    trpc.fileShare.agree.mutationOptions({ onSuccess: refresh, onError: failed }),
  );
  const discard = useMutation(
    trpc.fileShare.discard.mutationOptions({
      onSuccess: async () => {
        await refresh();
        onClose();
      },
      onError: failed,
    }),
  );
  const finish = useMutation(
    trpc.fileShare.finish.mutationOptions({
      onSuccess: async (result) => {
        toast('success', result.version ? t.made(result.version) : t.closed);
        await refresh();
      },
      onError: failed,
    }),
  );

  const waiting = data?.state === 'waiting';
  const settled = data ? data.remainingChanges + data.remainingComments === 0 : false;

  const fitting = data?.changes.filter((change) => change.fits) ?? [];
  const groups = new Map<number, Change[]>();
  for (const change of fitting) {
    groups.set(change.block!, [...(groups.get(change.block!) ?? []), change]);
  }
  const notFitting = data?.changes.filter((change) => !change.fits) ?? [];
  const placedComments = data?.comments.filter((comment) => !unplaced.includes(comment.id)) ?? [];
  const lostComments = data?.comments.filter((comment) => unplaced.includes(comment.id)) ?? [];

  const decisionBadge = (change: Change) =>
    change.decision === 'approved' ? (
      <Badge tone="success">{t.approved}</Badge>
    ) : change.decision === 'rejected' ? (
      <Badge tone="danger">{t.rejected}</Badge>
    ) : null;

  const changeText = (change: Change) => (
    <p className="mt-1 text-sm leading-5">
      <DiffText before={htmlText(change.oldHtml)} after={htmlText(change.newHtml)} />
    </p>
  );

  const decisionButtons = (change: Change, alone: boolean) =>
    waiting ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {change.decision === 'pending' ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => decide.mutate({ changeId: change.id, decision: 'rejected' })}
            >
              {t.reject}
            </Button>
            <Button
              size="sm"
              onClick={() => decide.mutate({ changeId: change.id, decision: 'approved' })}
            >
              {alone ? t.approve : t.approveThis}
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => decide.mutate({ changeId: change.id, decision: 'pending' })}
          >
            {t.undo}
          </Button>
        )}
      </div>
    ) : null;

  const commentCard = (comment: Detail['comments'][number]) => (
    <CommentCard
      key={comment.id}
      comment={comment}
      selected={selected === comment.id}
      onSelect={() => {
        setSelected(comment.id);
        send.current?.({ type: 'focus-comment', id: comment.id });
      }}
    >
      {comment.agreedAt ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="success">{t.agreed}</Badge>
          {comment.agreedBy ? <span className="text-xs text-muted">{comment.agreedBy}</span> : null}
          {waiting ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => agree.mutate({ draftId: id, commentId: comment.id, agreed: false })}
            >
              {t.reopen}
            </Button>
          ) : null}
        </div>
      ) : replying === comment.id ? (
        <CommentForm
          placeholder={c.replyPlaceholder}
          submit={c.send}
          pending={reply.isPending}
          onCancel={() => setReplying(null)}
          onSubmit={(body) => reply.mutate({ draftId: id, commentId: comment.id, body })}
        />
      ) : waiting ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setReplying(comment.id)}>
            {c.reply}
          </Button>
          <Button
            size="sm"
            onClick={() => agree.mutate({ draftId: id, commentId: comment.id, agreed: true })}
          >
            {t.agree}
          </Button>
        </div>
      ) : null}
    </CommentCard>
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        size="lg"
        className="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none gap-0 overflow-hidden rounded-2xl p-0"
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle py-3.5 pr-16 pl-5">
          <FileBadge name={data?.fileName ?? '.html'} />
          <div className="min-w-0 flex-[1_1_15rem]">
            <DialogTitle className="text-base break-words">{data?.fileName ?? ''}</DialogTitle>
            <DialogDescription>
              {data
                ? t.subtitle(
                    data.authorNames.join(', '),
                    formatDate(data.createdAt),
                    data.baseNumber ?? 0,
                  )
                : ''}
            </DialogDescription>
          </div>
        </header>
        {data ? (
          <div
            role="status"
            className={`flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-2.5 ${waiting && settled ? 'bg-success-soft' : ''}`}
          >
            <p className="min-w-0 flex-[1_1_18rem] text-sm font-semibold">
              {!waiting
                ? data.state === 'merged'
                  ? t.mergedInto
                  : data.versionNumber
                    ? t.finished(data.versionNumber)
                    : data.state === 'discarded'
                      ? t.discardedState
                      : t.closedState
                : settled
                  ? t.ready(data.approved)
                  : t.left(data.remainingChanges, data.remainingComments)}
            </p>
            {data.state === 'merged' && data.mergedIntoId ? (
              <Button onClick={() => onOpen(data.mergedIntoId!)}>{t.openMerged}</Button>
            ) : null}
            {waiting ? (
              <>
                <Button variant="secondary" onClick={() => setDiscarding(true)}>
                  {t.discard}
                </Button>
                {data.changes.length > 0 ? (
                  <Button
                    disabled={!settled || finish.isPending}
                    onClick={() => finish.mutate({ id })}
                  >
                    {data.approved > 0 || !settled ? t.makeVersion : t.closeDraft}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-wrap">
          <div className="h-full min-w-0 flex-[999_1_30rem] bg-surface">
            {frameSrc.current ? (
              <DocFrame
                key={frameSrc.current.src}
                src={frameSrc.current.src}
                title={data?.fileName ?? ''}
                sendRef={send}
                onMessage={onMessage}
              />
            ) : null}
          </div>
          <aside
            aria-label={t.changes(data?.changes.length ?? 0)}
            className="h-full flex-[1_1_24rem] overflow-auto border-l border-border-subtle bg-white px-3 pb-4"
          >
            {data && data.changes.length > 0 ? (
              <Heading>{t.changes(data.changes.length)}</Heading>
            ) : null}
            <ul className="space-y-2">
              {[...groups.values()].map((group) => {
                const alone = group.length === 1;
                return (
                  <li key={group[0]!.id} className="rounded-xl border border-border-subtle p-3">
                    {alone ? null : <p className="mb-2 text-xs text-muted">{t.alternatives}</p>}
                    {group.map((change) => (
                      <div key={change.id} className={alone ? '' : 'mt-3 first:mt-0'}>
                        <button
                          type="button"
                          className="block w-full text-left"
                          onClick={() => send.current?.({ type: 'focus-change', id: change.id })}
                        >
                          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                            {change.authorName} {decisionBadge(change)}
                          </span>
                          {changeText(change)}
                        </button>
                        {decisionButtons(change, alone)}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
            {notFitting.length > 0 ? (
              <>
                <Heading>{t.notFit(notFitting.length)}</Heading>
                <ul className="space-y-2">
                  {notFitting.map((change) => (
                    <li key={change.id} className="rounded-xl border border-border-subtle p-3">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        {change.authorName}. {t.notFitText} {decisionBadge(change)}
                      </p>
                      {changeText(change)}
                      {waiting && change.decision !== 'rejected' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-2"
                          onClick={() =>
                            decide.mutate({ changeId: change.id, decision: 'rejected' })
                          }
                        >
                          {t.reject}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {placedComments.length > 0 ? <Heading>{c.title(placedComments.length)}</Heading> : null}
            <div className="space-y-2">{placedComments.map(commentCard)}</div>
            {lostComments.length > 0 ? <Heading>{c.unplaced(lostComments.length)}</Heading> : null}
            <div className="space-y-2">{lostComments.map(commentCard)}</div>
          </aside>
        </div>
      </DialogContent>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={sk.sharing.drafts.discardConfirm.title}
        description={sk.sharing.drafts.discardConfirm.text}
        confirmLabel={sk.sharing.drafts.discardConfirm.confirm}
        destructive
        pending={discard.isPending}
        onConfirm={() => discard.mutate({ id })}
      />
    </Dialog>
  );
}
