import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowUp, Download, History, MessageSquare, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { CommentCard, CommentForm, textareaClass } from '@/components/share/comment-list';
import { DiffText } from '@/components/share/diff-text';
import { type BridgeMessage, DocFrame, type FrameRect } from '@/components/share/doc-frame';
import { FragmentEditor } from '@/components/share/fragment-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { errorCode, errorMessage } from '@/lib/errors';
import { FILES_REFRESH_MS, formatSize, previewKind } from '@/lib/files';
import { followFragmentLinks, markdownDocument } from '@/lib/safe-html';
import { trpc, trpcClient, type RouterOutputs } from '@/lib/trpc';

const t = sk.sharing;

export const Route = createFileRoute('/zdielanie')({ component: SharePage });

type Opened = RouterOutputs['publicShare']['open'];

const isLocked = (error: unknown) => errorCode(error) === 'LOCKED';

/**
 * The page behind a file's public link (`/zdielanie#<token>`), without a sign-in. The token stays in
 * the fragment, so the address can be kept and reloaded and no server log or referrer ever holds it;
 * it travels in POST bodies. Nothing of the file comes before the access screen is passed.
 */
function SharePage() {
  const [token] = useState(() => window.location.hash.slice(1));
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const info = useQuery({
    queryKey: ['public-share-info', token],
    enabled: valid,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => trpcClient.publicShare.info.mutate({ token }),
  });
  const [unlocked, setUnlocked] = useState(false);
  const [relocked, setRelocked] = useState(false);
  // Another link pasted over this one in the same tab.
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener('hashchange', reload);
    return () => window.removeEventListener('hashchange', reload);
  }, []);

  if (!valid || (info.isError && !unlocked)) return <Invalid />;
  if (!info.data) return <Centered>{null}</Centered>;
  const access = (
    <Access
      token={token}
      info={info.data}
      onForget={() => void info.refetch()}
      onOpen={() => {
        setUnlocked(true);
        setRelocked(false);
      }}
    />
  );
  if (!info.data.open && !unlocked) return access;
  // A session that ran out asks again over the page, which keeps what is unsaved.
  return (
    <>
      <Viewer
        token={token}
        onLocked={() => {
          void info.refetch();
          setRelocked(true);
        }}
      />
      {relocked ? <div className="fixed inset-0 z-50 overflow-auto">{access}</div> : null}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-[#f4f6f6] px-6 py-14">
      <BrandMark />
      {children ? (
        <main className="mt-7 w-full max-w-[480px] rounded-[20px] bg-white p-8 shadow-[0_1px_3px_rgba(12,59,60,0.06),0_8px_24px_rgba(12,59,60,0.1)]">
          {children}
        </main>
      ) : null}
    </div>
  );
}

function Invalid() {
  return (
    <Centered>
      <h1 className="text-2xl leading-[30px] font-bold">{t.access.invalidTitle}</h1>
      <p className="mt-2 text-[15px] leading-[23px] text-muted">{t.access.invalidText}</p>
    </Centered>
  );
}

function Access({
  token,
  info,
  onOpen,
  onForget,
}: {
  token: string;
  info: RouterOutputs['publicShare']['info'];
  onOpen: () => void;
  onForget: () => void;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const unlock = useMutation(trpc.publicShare.unlock.mutationOptions({ onSuccess: onOpen }));
  const forget = useMutation(trpc.publicShare.forget.mutationOptions({ onSuccess: onForget }));
  const a = t.access;
  const title = info.returningName ? a.back(info.returningName) : a.title;
  const text = info.returningName ? a.backText : info.needsName ? a.textName : a.textPassword;
  const code = unlock.error ? errorCode(unlock.error) : undefined;
  if (code === 'NOT_FOUND') return <Invalid />;
  return (
    <Centered>
      <h1 className="text-2xl leading-[30px] font-bold">{title}</h1>
      <p className="mt-2 mb-5 text-[15px] leading-[23px] text-muted">{text}</p>
      <form
        className="space-y-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          unlock.mutate({
            token,
            ...(info.needsName ? { name } : {}),
            ...(info.needsPassword ? { password } : {}),
          });
        }}
      >
        {info.needsName ? (
          <label className="block text-[13px] font-semibold">
            {a.name}
            <Input
              className="mt-1.5"
              autoComplete="name"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : null}
        {info.needsPassword ? (
          <label className="block text-[13px] font-semibold">
            {a.password}
            <Input
              className="mt-1.5"
              type="password"
              autoComplete="off"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        ) : null}
        {unlock.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(unlock.error, t.errors)}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="w-full" disabled={unlock.isPending}>
          {a.open}
        </Button>
      </form>
      {info.returningName ? (
        <p className="mt-4 text-center text-sm">
          <button
            type="button"
            className="font-medium text-primary-text hover:underline"
            onClick={() => forget.mutate({ token })}
          >
            {a.notMe(info.returningName)}
          </button>
        </p>
      ) : null}
    </Centered>
  );
}

function TopBar({
  file,
  onDownload,
  children,
}: {
  file: Opened;
  onDownload: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-white px-5 py-2.5">
      <BrandMark />
      <h1 className="min-w-0 flex-[1_1_12rem] text-[15px] leading-5 font-bold break-words">
        {file.name}
      </h1>
      {children}
      <Button variant="secondary" onClick={onDownload}>
        <Download className="size-4" aria-hidden />
        {t.page.download}
      </Button>
    </header>
  );
}

/** The open page: what it shows follows the file's type, and the mode comes from the server each time. */
function Viewer({ token, onLocked }: { token: string; onLocked: () => void }) {
  const toast = useToast();
  const opened = useQuery({
    queryKey: ['public-share-open', token],
    retry: false,
    refetchInterval: FILES_REFRESH_MS,
    queryFn: () => trpcClient.publicShare.open.mutate({ token }),
  });
  useEffect(() => {
    if (opened.error && isLocked(opened.error)) onLocked();
  }, [opened.error, onLocked]);

  const download = () =>
    void trpcClient.publicShare.download
      .mutate({ token, inline: false })
      .then(({ url }) => {
        window.location.assign(url);
      })
      .catch((error: unknown) => toast('error', errorMessage(error, t.errors)));

  if (opened.isError && !opened.data && !isLocked(opened.error)) return <Invalid />;
  const file = opened.data;
  if (!file) return <Centered>{null}</Centered>;
  if (file.frame) {
    return <HtmlViewer token={token} file={file} onDownload={download} />;
  }
  const kind = previewKind(file.name);
  if (kind) return <FileViewer token={token} file={file} kind={kind} onDownload={download} />;
  return (
    <Centered>
      <h1 className="text-xl leading-[26px] font-bold break-words">{file.name}</h1>
      <p className="mt-1 mb-5 text-sm text-muted">
        {formatSize(file.size)}. {t.page.noPreview}
      </p>
      <Button size="lg" className="w-full" onClick={download}>
        <Download className="size-4" aria-hidden />
        {t.page.download}
      </Button>
    </Centered>
  );
}

/** A PDF, a photo or Markdown: as in the app's preview. */
function FileViewer({
  token,
  file,
  kind,
  onDownload,
}: {
  token: string;
  file: Opened;
  kind: 'markdown' | 'pdf' | 'image' | 'html';
  onDownload: () => void;
}) {
  const content = useQuery({
    queryKey: ['public-share-file', token, file.versionId],
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const { url } = await trpcClient.publicShare.download.mutate({
        token,
        inline: kind !== 'markdown',
      });
      if (kind === 'image') return { image: url };
      const response = await fetch(url);
      if (!response.ok) throw new Error(`GET ${response.status}`);
      if (kind === 'markdown') {
        const { marked } = await import('marked');
        return { html: markdownDocument(await marked.parse(await response.text())) };
      }
      return { pdf: new Blob([await response.arrayBuffer()], { type: 'application/pdf' }) };
    },
  });
  const pdf = content.data?.pdf;
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pdf) return;
    const url = URL.createObjectURL(pdf);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdf]);
  return (
    <div className="flex h-dvh flex-col bg-surface">
      <TopBar file={file} onDownload={onDownload} />
      <main className="min-h-0 flex-1">
        {content.isError ? <p className="p-6 text-sm text-muted">{t.page.failed}</p> : null}
        {content.data?.image ? (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={content.data.image}
              alt={file.name}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        ) : null}
        {content.data?.html !== undefined ? (
          <iframe
            title={file.name}
            sandbox="allow-same-origin"
            srcDoc={content.data.html}
            onLoad={(event) => {
              const inside = event.currentTarget.contentDocument;
              if (inside) followFragmentLinks(inside);
            }}
            className="block h-full w-full border-0 bg-white"
          />
        ) : null}
        {pdfUrl ? (
          <iframe title={file.name} src={pdfUrl} className="block h-full w-full border-0" />
        ) : null}
      </main>
    </div>
  );
}

interface Hovered {
  block: number | null;
  editable: boolean;
  tag: string;
  src: string | null;
  text: string;
  parent: boolean;
  rect: FrameRect;
}

interface PendingChange {
  kind: 'edit' | 'delete';
  html: string | null;
  before: string;
  after: string;
}

type Composer = {
  rect: FrameRect | null;
  anchor: {
    block: number | null;
    quote: string | null;
    prefix: string | null;
    suffix: string | null;
    tag: string | null;
    src: string | null;
  };
};

/** A shared HTML document: reading, and in the other modes its comments and fragments. */
function HtmlViewer({
  token,
  file,
  onDownload,
}: {
  token: string;
  file: Opened;
  onDownload: () => void;
}) {
  const toast = useToast();
  // The frame this page started with: a newer version only offers itself.
  const [shown, setShown] = useState(() => ({ frame: file.frame!, versionId: file.versionId }));
  const [dismissed, setDismissed] = useState<string | null>(null);
  const newer = file.versionId !== shown.versionId && file.versionId !== dismissed;
  const canComment = file.mode !== 'read';
  const canEdit = file.canEdit;

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
    source: string;
    tag: string;
    styles: string;
    rect: FrameRect;
  } | null>(null);
  const [revision, setRevision] = useState<PendingChange | null>(null);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [selectedComment, setSelectedComment] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const ready = useRef(false);

  const comments = useQuery({
    queryKey: ['public-share-comments', token],
    enabled: canComment,
    retry: false,
    refetchInterval: FILES_REFRESH_MS,
    queryFn: () => trpcClient.publicShare.comments.mutate({ token }),
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
  const add = useMutation(
    trpc.publicShare.addComment.mutationOptions({
      onSuccess: async () => {
        setComposer(null);
        setDraftBody('');
        setReplying(null);
        setSelection(null);
        await comments.refetch();
      },
      onError: failed,
    }),
  );
  const editComment = useMutation(
    trpc.publicShare.editComment.mutationOptions({
      onSuccess: async () => {
        setChanging(null);
        await comments.refetch();
      },
      onError: failed,
    }),
  );
  const removeComment = useMutation(
    trpc.publicShare.deleteComment.mutationOptions({
      onSuccess: () => comments.refetch(),
      onError: failed,
    }),
  );
  const fragment = useMutation(trpc.publicShare.fragment.mutationOptions({ onError: failed }));
  const saveDraft = useMutation(
    trpc.publicShare.saveDraft.mutationOptions({
      onSuccess: () => {
        setSaved(new Map(changes));
        setJustSaved(true);
      },
      onError: failed,
    }),
  );

  const signature = (map: Map<number, PendingChange>) =>
    JSON.stringify([...map.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v.html]));
  const dirty = signature(changes) !== signature(saved);
  const unsaved = [...new Set([...changes.keys(), ...saved.keys()])].filter(
    (block) =>
      (changes.get(block)?.html ?? null) !== (saved.get(block)?.html ?? null) ||
      changes.has(block) !== saved.has(block),
  ).length;

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
    if (!target.editable) {
      toast('error', t.tools.notEditable);
      return;
    }
    const block = target.block;
    const pending = changes.get(block);
    fragment.mutate(
      { token, block },
      {
        onSuccess: (result) =>
          setEditing({
            block,
            before: pending?.before ?? target.text,
            source: pending?.html ?? result.html,
            tag: result.tag,
            styles: result.styles,
            rect: target.rect,
          }),
      },
    );
  };

  const applyEdit = (html: string, text: string) => {
    if (!editing) return;
    const { block, before } = editing;
    send.current?.({ type: 'apply', block, html, editable: true });
    setChanges((now) => new Map(now).set(block, { kind: 'edit', html, before, after: text }));
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

  const openComposer = (anchor: Composer['anchor'], rect: FrameRect | null) => {
    setDraftBody('');
    setComposer({ anchor, rect });
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
          onSubmit={(body) => editComment.mutate({ token, id: comment.id, body })}
        />
      ) : replying === comment.id ? (
        <CommentForm
          placeholder={t.comments.replyPlaceholder}
          submit={t.comments.send}
          pending={add.isPending}
          onCancel={() => setReplying(null)}
          onSubmit={(body) => add.mutate({ token, body, parentId: comment.id })}
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeComment.mutate({ token, id: comment.id })}
              >
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
              onClick={() =>
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
                  hovered.rect,
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
              {hovered.editable ? (
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

  return (
    <div className="flex h-dvh flex-col bg-[#dde6e3]">
      <TopBar file={file} onDownload={onDownload}>
        {file.visitorName ? (
          <span className="text-[13px] text-muted">{file.visitorName}</span>
        ) : null}
      </TopBar>
      {canEdit && dirty ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 bg-sidebar px-5 py-2.5 text-sm text-white"
        >
          <p className="min-w-0 flex-[1_1_12rem] font-semibold">{t.bar.unsaved(unsaved)}</p>
          <Button variant="secondary" onClick={() => setDiscarding(true)}>
            {t.bar.discard}
          </Button>
          <Button
            disabled={saveDraft.isPending}
            onClick={() =>
              saveDraft.mutate({
                token,
                baseVersionId: shown.versionId,
                ops: [...changes.entries()].map(([block, change]) => ({
                  block,
                  kind: change.kind,
                  ...(change.html === null ? {} : { html: change.html }),
                })),
              })
            }
          >
            {t.bar.save}
          </Button>
        </div>
      ) : null}
      {justSaved && !dirty ? (
        <div role="status" className="bg-success-soft px-5 py-2.5 text-sm">
          {t.bar.saved}
        </div>
      ) : null}
      {newer ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-white px-5 py-2.5 text-sm"
        >
          <p className="min-w-0 flex-[1_1_15rem]">{t.page.newVersion}</p>
          <Button variant="secondary" onClick={() => setDismissed(file.versionId)}>
            {t.page.later}
          </Button>
          <Button
            onClick={() => {
              ready.current = false;
              setChanges(new Map());
              setSaved(new Map());
              setShown({ frame: file.frame!, versionId: file.versionId });
            }}
          >
            {t.page.load}
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-wrap overflow-auto md:overflow-hidden">
        <div
          ref={frameBox}
          className="relative h-[70dvh] min-w-0 flex-[999_1_20rem] bg-white md:h-full"
        >
          <DocFrame
            key={shown.frame}
            src={shown.frame}
            title={file.name}
            sendRef={send}
            onMessage={onMessage}
          />
          {tools}
          {selection && canComment && !composer && !editing ? (
            <Button
              size="sm"
              className="absolute z-10"
              style={{
                top: Math.max(4, selection.rect.top - 38),
                left: Math.max(4, Math.min(boxWidth - 130, selection.rect.left)),
              }}
              onClick={() =>
                openComposer(
                  {
                    block: selection.block,
                    quote: selection.text,
                    prefix: selection.prefix,
                    suffix: selection.suffix,
                    tag: null,
                    src: null,
                  },
                  selection.rect,
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
                top: Math.max(8, (composer.rect?.top ?? 0) + (composer.rect?.height ?? 0) + 6),
                left: Math.max(8, Math.min(boxWidth - 360, composer.rect?.left ?? 8)),
              }}
              onSubmit={(event) => {
                event.preventDefault();
                if (draftBody.trim()) {
                  add.mutate({ token, body: draftBody.trim(), anchor: composer.anchor });
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
                top: Math.max(8, Math.min(editing.rect.top, 120)),
                left: Math.max(8, Math.min(boxWidth - 520, editing.rect.left)),
                width: Math.min(boxWidth - 16, Math.max(512, editing.rect.width)),
              }}
            >
              <FragmentEditor
                source={editing.source}
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
  onClick: () => void;
  children: React.ReactNode;
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
