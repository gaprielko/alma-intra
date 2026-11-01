import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { type DocApi, DocWorkspace, type SaveOp } from '@/components/share/doc-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { restoreSession } from '@/lib/auth';
import { errorCode, errorMessage } from '@/lib/errors';
import { FILES_REFRESH_MS, formatSize, previewKind } from '@/lib/files';
import { followFragmentLinks, markdownDocument } from '@/lib/safe-html';
import { rememberShareLink } from '@/lib/share-return';
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
  const navigate = useNavigate();
  // A colleague needs no link's permission: only to learn which file this is, then on to Súbory.
  const [colleague, setColleague] = useState<'checking' | 'no' | 'gone'>(valid ? 'checking' : 'no');
  useEffect(() => {
    if (!valid) return;
    void (async () => {
      if (!(await restoreSession({ quick: true }))) {
        setColleague('no');
        return;
      }
      try {
        const file = await trpcClient.fileShare.resolve.mutate({ token });
        await navigate({ to: '/files', search: { folder: file.folderId, open: file.fileId } });
      } catch {
        setColleague('gone');
      }
    })();
  }, [valid, token, navigate]);
  const info = useQuery({
    queryKey: ['public-share-info', token],
    enabled: valid && colleague === 'no',
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

  if (colleague === 'checking') return <Centered>{null}</Centered>;
  if (!valid || colleague === 'gone' || (info.isError && !unlocked)) {
    return <Invalid token={valid && colleague !== 'gone' ? token : null} />;
  }
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

/**
 * A colleague opens any link, an expired one too. On a link that does not open, the offer looks the
 * same whatever the reason; `null`: signed in already and it still does not open.
 */
function ColleagueLogin({ token }: { token: string }) {
  return (
    <p className="mt-[18px] border-t border-border-subtle pt-4 text-center text-sm">
      {t.access.colleague}{' '}
      <Link
        to="/login"
        onClick={() => rememberShareLink(token)}
        className="font-semibold text-primary-text hover:underline"
      >
        {t.access.colleagueLogin}
      </Link>
    </p>
  );
}

function Invalid({ token }: { token: string | null }) {
  return (
    <Centered>
      <h1 className="text-2xl leading-[30px] font-bold">{t.access.invalidTitle}</h1>
      <p className="mt-2 text-[15px] leading-[23px] text-muted">{t.access.invalidText}</p>
      {token ? <ColleagueLogin token={token} /> : null}
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
  if (code === 'NOT_FOUND') return <Invalid token={token} />;
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
      <ColleagueLogin token={token} />
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

  if (opened.isError && !opened.data && !isLocked(opened.error)) return <Invalid token={token} />;
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
  const api = useMemo<DocApi>(
    () => ({
      key: ['public-share-comments', token],
      comments: () => trpcClient.publicShare.comments.mutate({ token }),
      addComment: (input) => trpcClient.publicShare.addComment.mutate({ token, ...input }),
      editComment: (id, body) => trpcClient.publicShare.editComment.mutate({ token, id, body }),
      deleteComment: (id) => trpcClient.publicShare.deleteComment.mutate({ token, id }),
      fragment: (block) => trpcClient.publicShare.fragment.mutate({ token, block }),
    }),
    [token],
  );
  const saveDraft = useMutation({
    mutationFn: (ops: SaveOp[]) =>
      trpcClient.publicShare.saveDraft.mutate({ token, baseVersionId: shown.versionId, ops }),
    onError: (error) => toast('error', errorMessage(error, t.errors)),
  });
  return (
    <div className="flex h-dvh flex-col bg-[#dde6e3]">
      <TopBar file={file} onDownload={onDownload}>
        {file.visitorName ? (
          <span className="text-[13px] text-muted">{file.visitorName}</span>
        ) : null}
      </TopBar>
      {newer ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-white px-5 py-2.5 text-sm"
        >
          <p className="min-w-0 flex-[1_1_15rem]">{t.page.newVersion}</p>
          <Button variant="secondary" onClick={() => setDismissed(file.versionId)}>
            {t.page.later}
          </Button>
          <Button onClick={() => setShown({ frame: file.frame!, versionId: file.versionId })}>
            {t.page.load}
          </Button>
        </div>
      ) : null}
      <DocWorkspace
        key={shown.frame}
        frame={shown.frame}
        title={file.name}
        api={api}
        canComment={file.mode !== 'read'}
        canEdit={file.canEdit}
        savedText={t.bar.saved}
        bar={({ unsaved, ops, discard, markSaved }) => (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 bg-sidebar px-5 py-2.5 text-sm text-white"
          >
            <p className="min-w-0 flex-[1_1_12rem] font-semibold">{t.bar.unsaved(unsaved)}</p>
            <Button variant="secondary" onClick={discard}>
              {t.bar.discard}
            </Button>
            <Button
              disabled={saveDraft.isPending}
              onClick={() => saveDraft.mutate(ops, { onSuccess: markSaved })}
            >
              {t.bar.save}
            </Button>
          </div>
        )}
      />
    </div>
  );
}
