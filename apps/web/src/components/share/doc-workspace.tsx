import { sk } from '@intra/shared/i18n';
import type { CommentAnchor } from '@intra/shared/schemas';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUp, History, MessageSquare, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  CommentCard,
  CommentForm,
  type CommentRow,
  textareaClass,
} from '@/components/share/comment-list';
import { DiffText } from '@/components/share/diff-text';
import { type BridgeMessage, DocFrame, type FrameRect } from '@/components/share/doc-frame';
import { type EditedText, FragmentEditor } from '@/components/share/fragment-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { FILES_REFRESH_MS } from '@/lib/files';

const t = sk.sharing;

const COMPOSER_WIDTH = 352;
const COMPOSER_HEIGHT = 172;

interface Hovered {
  block: number | null;
  editable: boolean;
  textable: boolean;
  pendingInside: boolean;
  tag: string;
  src: string | null;
  text: string;
  parent: boolean;
  rect: FrameRect;
}

interface PendingChange {
  kind: 'edit' | 'delete' | 'text';
  texts?: EditedText[];
  html: string | null;
  before: string;
  after: string;
}

type Composer = {
  /** Where the pointer was, in the frame's box: the window opens there, wherever the text is. */
  at: { x: number; y: number };
  anchor: {
    block: number | null;
    quote: string | null;
    prefix: string | null;
    suffix: string | null;
    tag: string | null;
    src: string | null;
  };
};

export interface WorkspaceComment extends CommentRow {
  anchor: CommentAnchor | null;
  own: boolean;
  sameVersion: boolean;
  /** Written during this visit of the editor. */
  thisVisit?: boolean;
  replies: (CommentRow['replies'][number] & { thisVisit?: boolean })[];
}

/** Where a workspace gets its comments and fragments: the public link's, or a colleague's. */
export interface DocApi {
  key: readonly unknown[];
  comments: () => Promise<WorkspaceComment[]>;
  addComment: (input: {
    body: string;
    anchor?: Composer['anchor'];
    parentId?: string;
  }) => Promise<unknown>;
  editComment: (id: string, body: string) => Promise<unknown>;
  deleteComment: (id: string) => Promise<unknown>;
  fragment: (block: number) => Promise<{
    html: string | null;
    textHtml: string | null;
    tag: string;
    styles: string;
  }>;
}

export interface SaveOp {
  block: number;
  kind: 'edit' | 'delete' | 'text';
  html?: string;
  texts?: EditedText[];
}

export interface WorkspaceBar {
  unsaved: number;
  ops: SaveOp[];
  wroteComment: boolean;
  /** „Zahodiť zmeny“, with its confirmation. */
  discard: () => void;
  /** What was sent is the new starting point. */
  markSaved: () => void;
}

/**
 * A document in its isolated frame with hover icons, the editor and comments, wherever it is shown.
 * How changes are saved is up to `bar`, which shows only when there is something to save.
 */
export function DocWorkspace({
  frame,
  title,
  api,
  canComment,
  canEdit,
  savedText,
  bar,
  onChange,
}: {
  frame: string;
  title: string;
  api: DocApi;
  canComment: boolean;
  canEdit: boolean;
  savedText: string;
  bar: (state: WorkspaceBar) => ReactNode;
  /** Whether something is unsaved, for whoever closes this. */
  onChange?: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const send = useRef<((message: Record<string, unknown>) => void) | null>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const hoverOut = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The frame's message that the pointer left arrives after the pointer is on the icons.
  const overTools = useRef(false);
  const [selection, setSelection] = useState<{
    text: string;
    prefix: string;
    suffix: string;
    block: number | null;
    rect: FrameRect;
  } | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [changes, setChanges] = useState<Map<number, PendingChange>>(new Map());
  const [saved, setSaved] = useState<Map<number, PendingChange>>(new Map());
  const [justSaved, setJustSaved] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [editing, setEditing] = useState<{
    block: number;
    before: string;
    source: string | null;
    textHtml: string | null;
    texts: EditedText[] | undefined;
    tag: string;
    styles: string;
    rect: FrameRect;
    textable: boolean;
  } | null>(null);
  const [revision, setRevision] = useState<PendingChange | null>(null);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [selectedComment, setSelectedComment] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const ready = useRef(false);

  const comments = useQuery({
    queryKey: api.key,
    enabled: canComment,
    retry: false,
    refetchInterval: FILES_REFRESH_MS,
    queryFn: api.comments,
  });
  const list = comments.data ?? [];
  const frameComments = list.map((comment) => ({
    id: comment.id,
    anchor: comment.anchor,
    sameVersion: comment.sameVersion,
  }));
  const commentsKey = list.map((comment) => comment.id).join();
  useEffect(() => {
    if (ready.current) send.current?.({ type: 'comments', list: frameComments });
    // Only when the set changes.
  }, [commentsKey]);

  const failed = (error: unknown) => toast('error', errorMessage(error, t.errors));
  const add = useMutation({
    mutationFn: api.addComment,
    onSuccess: async () => {
      setComposer(null);
      setDraftBody('');
      setReplying(null);
      setSelection(null);
      await comments.refetch();
    },
    onError: failed,
  });
  const editComment = useMutation({
    mutationFn: (input: { id: string; body: string }) => api.editComment(input.id, input.body),
    onSuccess: async () => {
      setChanging(null);
      await comments.refetch();
    },
    onError: failed,
  });
  const removeComment = useMutation({
    mutationFn: api.deleteComment,
    onSuccess: () => comments.refetch(),
    onError: failed,
  });
  const fragment = useMutation({ mutationFn: api.fragment, onError: failed });

  const signature = (map: Map<number, PendingChange>) =>
    JSON.stringify([...map.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v.html]));
  const dirty = signature(changes) !== signature(saved);
  const unsaved = [...new Set([...changes.keys(), ...saved.keys()])].filter(
    (block) =>
      (changes.get(block)?.html ?? null) !== (saved.get(block)?.html ?? null) ||
      changes.has(block) !== saved.has(block),
  ).length;

  useEffect(() => onChange?.(dirty), [dirty, onChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onMessage = (message: BridgeMessage) => {
    if (message.type === 'ready') {
      ready.current = true;
      if (canComment) send.current?.({ type: 'comments', list: frameComments });
    } else if (message.type === 'hover') {
      if (hoverOut.current) clearTimeout(hoverOut.current);
      if (message.block === null || !message.rect) {
        setHovered(null);
      } else {
        setHovered({
          block: message.block,
          editable: message.editable === true,
          textable: message.textable === true,
          pendingInside: message.pendingInside === true,
          tag: String(message.tag ?? ''),
          src: message.src ?? null,
          text: message.text ?? '',
          parent: message.parent === true,
          rect: message.rect,
        });
      }
    } else if (message.type === 'hover-out') {
      if (!overTools.current) hoverOut.current = setTimeout(() => setHovered(null), 500);
    } else if (message.type === 'rect') {
      setHovered((now) => (now ? { ...now, rect: message.rect } : now));
    } else if (message.type === 'selection') {
      setSelection(
        message.text && message.rect
          ? {
              text: message.text,
              prefix: message.prefix ?? '',
              suffix: message.suffix ?? '',
              block: message.block ?? null,
              rect: message.rect,
            }
          : null,
      );
    } else if (message.type === 'comments-placed') {
      setUnplaced(message.unplaced);
      setOrder(message.order);
    } else if (message.type === 'comment-click') {
      setSelectedComment(message.id);
    }
  };

  const startEdit = (target: Hovered) => {
    if (target.block === null) return;
    if (target.pendingInside) {
      toast('error', t.tools.pendingInside);
      return;
    }
    if (!target.editable && !target.textable) {
      toast('error', t.tools.notEditable);
      return;
    }
    const block = target.block;
    const pending = changes.get(block);
    fragment.mutate(block, {
      onSuccess: (result) =>
        setEditing({
          block,
          before: pending?.before ?? target.text,
          source: pending?.kind === 'edit' ? pending.html : result.html,
          textHtml: result.textHtml,
          texts: pending?.texts,
          tag: result.tag,
          styles: result.styles,
          rect: target.rect,
          textable: target.textable,
        }),
    });
  };

  const applyEdit = (html: string, text: string, texts?: EditedText[]) => {
    if (!editing) return;
    const { block, before, textable } = editing;
    if (texts?.length === 0) {
      undoBlock(block);
      setEditing(null);
      return;
    }
    send.current?.({ type: 'apply', block, html, editable: !texts, textable });
    setChanges((now) =>
      new Map(now).set(block, {
        kind: texts ? 'text' : 'edit',
        html,
        before,
        after: text,
        ...(texts ? { texts } : {}),
      }),
    );
    setJustSaved(false);
    setEditing(null);
  };

  const removeBlock = (target: Hovered) => {
    if (target.block === null) return;
    send.current?.({ type: 'apply', block: target.block, html: null });
    const before = changes.get(target.block)?.before ?? target.text;
    setChanges((now) =>
      new Map(now).set(target.block!, { kind: 'delete', html: null, before, after: '' }),
    );
    setJustSaved(false);
    setHovered(null);
  };

  const undoBlock = (block: number) => {
    send.current?.({ type: 'restore', block });
    setChanges((now) => {
      const next = new Map(now);
      next.delete(block);
      return next;
    });
    setHovered(null);
  };

  /** Back to what was last sent, or to the document as it came. */
  const discardAll = () => {
    for (const block of new Set([...changes.keys(), ...saved.keys()])) {
      const kept = saved.get(block);
      send.current?.({ type: 'restore', block });
      if (kept) {
        send.current?.({ type: 'apply', block, html: kept.html, editable: kept.html !== null });
      }
    }
    setChanges(new Map(saved));
    setDiscarding(false);
  };

  const openComposer = (anchor: Composer['anchor'], event: MouseEvent) => {
    const here = frameBox.current?.getBoundingClientRect();
    setDraftBody('');
    setComposer({
      anchor,
      at: { x: event.clientX - (here?.left ?? 0), y: event.clientY - (here?.top ?? 0) },
    });
  };

  const sortedComments = [...list].sort((a, b) => {
    const at = order.indexOf(a.id);
    const bt = order.indexOf(b.id);
    return (at < 0 ? Infinity : at) - (bt < 0 ? Infinity : bt);
  });
  const placed = sortedComments.filter((comment) => !unplaced.includes(comment.id));
  const lost = sortedComments.filter((comment) => unplaced.includes(comment.id));

  const commentCard = (comment: (typeof list)[number]) => (
    <CommentCard
      key={comment.id}
      comment={comment}
      selected={selectedComment === comment.id}
      {...(comment.own ? { name: t.comments.you(comment.authorName) } : {})}
      onSelect={() => {
        setSelectedComment(comment.id);
        send.current?.({ type: 'focus-comment', id: comment.id });
      }}
    >
      {changing === comment.id ? (
        <CommentForm
          initial={comment.body}
          placeholder={t.comments.placeholder}
          submit={t.comments.save}
          pending={editComment.isPending}
          onCancel={() => setChanging(null)}
          onSubmit={(body) => editComment.mutate({ id: comment.id, body })}
        />
      ) : replying === comment.id ? (
        <CommentForm
          placeholder={t.comments.replyPlaceholder}
          submit={t.comments.send}
          pending={add.isPending}
          onCancel={() => setReplying(null)}
          onSubmit={(body) => add.mutate({ body, parentId: comment.id })}
        />
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={() => setReplying(comment.id)}>
            {t.comments.reply}
          </Button>
          {comment.own ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setChanging(comment.id)}>
                {t.comments.edit}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => removeComment.mutate(comment.id)}>
                {t.comments.delete}
              </Button>
            </>
          ) : null}
        </div>
      )}
    </CommentCard>
  );

  const box = frameBox.current?.getBoundingClientRect();
  const boxWidth = box?.width ?? 800;
  const boxHeight = box?.height ?? 600;
  const pending = hovered?.block != null ? changes.get(hovered.block) : undefined;
  const tools =
    hovered &&
    hovered.block !== null &&
    (canEdit || canComment) &&
    !editing &&
    !composer &&
    !selection ? (
      <>
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-md outline-2 outline-primary"
          style={{
            top: hovered.rect.top,
            left: hovered.rect.left,
            width: hovered.rect.width,
            height: hovered.rect.height,
          }}
        />
        <div
          className="absolute z-10 flex gap-1"
          style={{
            top: Math.max(4, hovered.rect.top - 16),
            right: Math.max(4, boxWidth - hovered.rect.left - hovered.rect.width + 6),
          }}
          onMouseEnter={() => {
            overTools.current = true;
            if (hoverOut.current) clearTimeout(hoverOut.current);
          }}
          onMouseLeave={() => {
            overTools.current = false;
            hoverOut.current = setTimeout(() => setHovered(null), 500);
          }}
        >
          {pending ? (
            <ToolIcon label={t.tools.changes} onClick={() => setRevision(pending)}>
              <History className="size-4" aria-hidden />
            </ToolIcon>
          ) : null}
          {canComment && !pending ? (
            <ToolIcon
              label={t.tools.comment}
              onClick={(event) =>
                openComposer(
                  {
                    block: hovered.block,
                    // A block of text is found again by its words, a picture by its address.
                    quote: hovered.text.trim().slice(0, 2000) || null,
                    prefix: null,
                    suffix: null,
                    tag: hovered.tag,
                    src: hovered.src,
                  },
                  event,
                )
              }
            >
              <MessageSquare className="size-4" aria-hidden />
            </ToolIcon>
          ) : null}
          {canEdit && pending ? (
            <ToolIcon label={t.tools.undo} onClick={() => undoBlock(hovered.block!)}>
              <Undo2 className="size-4" aria-hidden />
            </ToolIcon>
          ) : null}
          {canEdit && pending?.kind !== 'delete' ? (
            <>
              {hovered.parent ? (
                <ToolIcon
                  label={t.tools.parent}
                  onClick={() => send.current?.({ type: 'parent', block: hovered.block })}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </ToolIcon>
              ) : null}
              {hovered.editable || hovered.textable ? (
                <ToolIcon label={t.tools.edit} onClick={() => startEdit(hovered)}>
                  <Pencil className="size-4" aria-hidden />
                </ToolIcon>
              ) : null}
              <ToolIcon label={t.tools.delete} onClick={() => removeBlock(hovered)}>
                <Trash2 className="size-4" aria-hidden />
              </ToolIcon>
            </>
          ) : null}
        </div>
      </>
    ) : null;

  const wroteComment = list.some(
    (comment) => comment.thisVisit || comment.replies.some((reply) => reply.thisVisit),
  );
  const ops = [...changes.entries()].map(([block, change]) => ({
    block,
    kind: change.kind,
    ...(change.texts ? { texts: change.texts } : change.html === null ? {} : { html: change.html }),
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {canEdit && dirty
        ? bar({
            unsaved,
            ops,
            wroteComment,
            discard: () => setDiscarding(true),
            markSaved: () => {
              setSaved(new Map(changes));
              setJustSaved(true);
            },
          })
        : null}
      {justSaved && !dirty ? (
        <div role="status" className="bg-success-soft px-5 py-2.5 text-sm">
          {savedText}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-wrap overflow-auto md:overflow-hidden">
        <div
          ref={frameBox}
          className="relative h-[70dvh] min-w-0 flex-[999_1_20rem] overflow-hidden bg-white md:h-full"
        >
          <DocFrame src={frame} title={title} sendRef={send} onMessage={onMessage} />
          {tools}
          {selection && canComment && !composer && !editing ? (
            <Button
              size="sm"
              className="absolute z-10"
              style={{
                top: Math.max(4, selection.rect.top - 38),
                left: Math.max(4, Math.min(boxWidth - 130, selection.rect.left)),
              }}
              onClick={(event) =>
                openComposer(
                  {
                    block: selection.block,
                    quote: selection.text,
                    prefix: selection.prefix,
                    suffix: selection.suffix,
                    tag: null,
                    src: null,
                  },
                  event,
                )
              }
            >
              <MessageSquare className="size-4" aria-hidden />
              {t.tools.comment}
            </Button>
          ) : null}
          {composer ? (
            <form
              aria-label={t.comments.new}
              className="absolute z-20 w-[min(22rem,calc(100%-1rem))] rounded-xl border border-border-subtle bg-white p-3 shadow-[0_12px_32px_rgba(12,43,44,0.25)]"
              style={{
                top: Math.max(8, Math.min(boxHeight - COMPOSER_HEIGHT - 8, composer.at.y + 8)),
                left: Math.max(8, Math.min(boxWidth - COMPOSER_WIDTH - 8, composer.at.x - 16)),
              }}
              onSubmit={(event) => {
                event.preventDefault();
                if (draftBody.trim()) {
                  add.mutate({ body: draftBody.trim(), anchor: composer.anchor });
                }
              }}
            >
              {/* The anchor came from the frame: shown as text and stored as data, nothing more. */}
              <textarea
                autoFocus
                aria-label={t.comments.placeholder}
                placeholder={t.comments.placeholder}
                maxLength={4000}
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                className={textareaClass}
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setComposer(null)}
                >
                  {t.comments.cancel}
                </Button>
                <Button type="submit" size="sm" disabled={add.isPending || !draftBody.trim()}>
                  {t.comments.add}
                </Button>
              </div>
            </form>
          ) : null}
          {editing ? (
            <div
              className="absolute z-20"
              style={{
                top: Math.max(8, Math.min(editing.rect.top, boxHeight * 0.2)),
                left: Math.max(8, Math.min(boxWidth - 520, editing.rect.left)),
                width: Math.min(boxWidth - 16, Math.max(512, editing.rect.width)),
              }}
            >
              <FragmentEditor
                source={editing.source}
                textHtml={editing.textHtml}
                texts={editing.texts}
                tag={editing.tag}
                styles={editing.styles}
                onCancel={() => setEditing(null)}
                onSave={applyEdit}
                onRefuse={() => {
                  setEditing(null);
                  toast('error', t.tools.notEditable);
                }}
              />
            </div>
          ) : null}
          {revision ? (
            <section
              aria-label={t.diff.title}
              className="absolute inset-x-2 bottom-2 z-20 mx-auto max-w-2xl rounded-xl border border-border-subtle bg-white p-4 shadow-[0_12px_32px_rgba(12,43,44,0.25)]"
            >
              <div className="flex items-start gap-3">
                <h2 className="flex-1 text-sm font-semibold">
                  {revision.kind === 'delete' ? t.diff.deleted : t.diff.title}
                </h2>
                <button
                  type="button"
                  aria-label={t.diff.close}
                  onClick={() => setRevision(null)}
                  className="text-muted"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <p className="mt-2 max-h-64 overflow-auto text-sm leading-6">
                <DiffText before={revision.before} after={revision.after} />
              </p>
            </section>
          ) : null}
        </div>
        {canComment ? (
          <aside
            aria-label={t.comments.title(list.length)}
            className="max-w-full flex-[1_1_20rem] overflow-auto border-l border-border-subtle bg-white px-3 pb-4 md:h-full md:max-w-[26rem]"
          >
            <p className="px-1 pt-3 pb-1.5 text-xs font-semibold tracking-[0.06em] text-tertiary uppercase">
              {t.comments.title(placed.length)}
            </p>
            {list.length === 0 ? (
              <p className="px-1 text-sm text-muted">{t.comments.empty}</p>
            ) : null}
            <div className="space-y-2">{placed.map(commentCard)}</div>
            {lost.length > 0 ? (
              <p className="px-1 pt-3 pb-1.5 text-xs font-semibold tracking-[0.06em] text-tertiary uppercase">
                {t.comments.unplaced(lost.length)}
              </p>
            ) : null}
            <div className="space-y-2">{lost.map(commentCard)}</div>
          </aside>
        ) : null}
      </div>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t.bar.discardConfirm.title}
        description={t.bar.discardConfirm.text}
        confirmLabel={t.bar.discardConfirm.confirm}
        destructive
        onConfirm={discardAll}
      />
    </div>
  );
}

function ToolIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (event: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-primary-text shadow-rest hover:bg-primary-soft"
    >
      {children}
    </button>
  );
}
