import { sk } from '@intra/shared/i18n';
import { personName } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Building2, ChevronDown, Paperclip, Reply, Trash2, UserRound } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { ReplyDialog } from '@/components/emails/reply-dialog';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { downloadFile } from '@/lib/uploads';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.inbound;

export const Route = createFileRoute('/_app/emails_/inbox/$inboundId')({
  component: InboundPage,
});

/**
 * The received HTML as a document of its own, for a frame without scripts: its CSP lets nothing
 * load from outside (no tracking pixels, no remote fonts or styles), only what the e-mail carries.
 */
const safeDocument = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">` +
  `<style>body{margin:16px;font:14px/1.5 system-ui,sans-serif;color:#1b2424;overflow-wrap:anywhere}</style>` +
  `</head><body>${html}</body></html>`;

/** One received e-mail: who, when, under whom it is filed, the text, and what to do with it. */
function InboundPage() {
  const { inboundId } = Route.useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [replying, setReplying] = useState(false);
  const inbound = useQuery(trpc.inbound.get.queryOptions({ id: inboundId }));
  // Opening a conversation reads it; the list shows that, this page has what it needs.
  const { mutate: markRead } = useMutation(
    trpc.inbound.markRead.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.inbound.list.pathFilter()),
    }),
  );
  const unopened = inbound.data?.readAt === null;
  useEffect(() => {
    if (unopened) markRead({ id: inboundId, read: true });
  }, [inboundId, unopened, markRead]);
  const thread = useQuery(trpc.inbound.thread.queryOptions({ id: inboundId }));
  const rest = thread.data ?? [];
  const discard = useMutation(
    trpc.inbound.discard.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.inbound.pathFilter());
        toast('success', t.discardConfirm.done);
        await navigate({ to: '/emails/inbox' });
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const back = { to: '/emails/inbox', label: t.back } as const;
  if (inbound.isPending) {
    return (
      <div>
        <PageHeader title={sk.common.loading} back={back} />
        <div className="p-7">
          <CardSkeleton lines={6} />
        </div>
      </div>
    );
  }
  if (loadFailed(inbound)) {
    return (
      <div>
        <PageHeader title={t.back} back={back} />
        <ErrorState
          text={errorMessage(inbound.error, t.errors)}
          onRetry={() => void inbound.refetch()}
        />
      </div>
    );
  }
  const m = inbound.data;
  return (
    <div>
      <PageHeader
        title={m.subject || t.noSubject}
        back={back}
        badge={
          m.status === 'unassigned' ? (
            <Badge tone="warning" dot>
              {t.unassigned}
            </Badge>
          ) : rest.length > 0 ? (
            <Badge tone="neutral">{t.thread.count(rest.length + 1)}</Badge>
          ) : undefined
        }
      >
        <Button variant="secondary" onClick={() => setAssigning(true)}>
          <Building2 className="size-4" aria-hidden />
          {m.status === 'unassigned' ? t.assign : t.reassign}
        </Button>
        <Button variant="ghost" onClick={() => setDiscarding(true)}>
          <Trash2 className="size-4" aria-hidden />
          {t.discard}
        </Button>
      </PageHeader>
      <main className="grid items-start gap-5 px-7 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Card className="min-w-0 overflow-hidden">
          <MessageHeader
            message={m}
            onReply={m.status === 'assigned' ? () => setReplying(true) : undefined}
          />
          {m.html ? (
            <iframe
              title={t.plainText}
              // No scripts, no forms, no popups: the HTML is the sender's and untrusted. The origin
              // is kept only so the frame paints; without scripts nothing can use it.
              sandbox="allow-same-origin"
              srcDoc={safeDocument(m.html)}
              className="block h-[65vh] w-full border-0 bg-white"
            />
          ) : m.text ? (
            <pre className="p-5 font-sans text-sm whitespace-pre-wrap">{m.text}</pre>
          ) : (
            <p className="p-5 text-sm text-muted">{t.noBody}</p>
          )}
          {m.html ? (
            <p className="border-t border-border-subtle px-5 py-2 text-xs text-muted">
              {t.safeNote}
            </p>
          ) : null}
          {rest.length > 0 ? <OlderInThread items={rest} /> : null}
        </Card>
        <OtherConversations inboundId={m.id} who={m.contactName ?? m.fromName ?? m.fromEmail} />
      </main>
      {assigning ? (
        <AssignDialog
          inboundId={m.id}
          fromEmail={m.fromEmail}
          current={m.customerId ? { id: m.customerId, name: m.customerName ?? '' } : null}
          onClose={() => setAssigning(false)}
        />
      ) : null}
      {replying ? (
        <ReplyDialog
          inboundId={m.id}
          to={m.fromName ?? m.fromEmail}
          onClose={() => setReplying(false)}
        />
      ) : null}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t.discardConfirm.title}
        description={t.discardConfirm.text}
        confirmLabel={t.discardConfirm.confirm}
        pending={discard.isPending}
        onConfirm={() => discard.mutate({ id: m.id })}
      />
    </div>
  );
}

type Message = RouterOutputs['inbound']['get'];

/**
 * Over the text, in short: the contact it is filed under (or the sender), to whom and when; the
 * attachments behind a button, each opened from its menu. The subject above says what it answers.
 */
function MessageHeader({
  message: m,
  onReply,
}: {
  message: Message;
  /** „Odpovedať“, next to the attachments; an unassigned e-mail is assigned first. */
  onReply: (() => void) | undefined;
}) {
  const toast = useToast();
  const who = m.contactName ?? m.fromName ?? m.fromEmail;
  return (
    <header className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
      <span
        aria-hidden
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-xs font-bold text-warning"
      >
        {initialsOf(who)}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p>
          {m.contactId ? (
            <Link
              to="/contacts/$personId"
              params={{ personId: m.contactId }}
              className="font-bold hover:underline"
            >
              {who}
            </Link>
          ) : (
            <span className="font-bold">{who}</span>
          )}
          {m.contactPosition ? <span className="text-muted"> · {m.contactPosition}</span> : null}
          {m.customerId ? (
            <>
              <span className="text-muted"> · </span>
              <Link
                to="/organizations/$customerId"
                params={{ customerId: m.customerId }}
                className="font-semibold text-primary-text hover:underline"
              >
                {m.customerName}
              </Link>
            </>
          ) : null}
        </p>
        <p className="text-muted">
          {[m.fromEmail, t.toLine(m.toEmails.join(', ')), formatDateTime(m.receivedAt)].join(' · ')}
        </p>
      </div>
      {onReply ? (
        <Button size="sm" onClick={onReply}>
          <Reply className="size-3.5" aria-hidden />
          {t.reply}
        </Button>
      ) : null}
      {m.attachments.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              <Paperclip className="size-3.5" aria-hidden />
              {t.attachmentsButton(m.attachments.length)}
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            {m.attachments.map((file) =>
              file.fileId ? (
                <DropdownMenuItem
                  key={file.id}
                  onSelect={() =>
                    void downloadFile(file.fileId!, file.filename).catch((error: unknown) =>
                      toast('error', errorMessage(error, sk.files.errors)),
                    )
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{file.filename}</span>
                    <span className="block text-xs text-muted">{t.savedToFolder}</span>
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={file.id} disabled>
                  <span className="min-w-0">
                    <span className="block truncate">{file.filename}</span>
                    <span className="block text-xs text-muted">
                      {file.skipped ? t.skipped[file.skipped] : t.notSavedYet}
                    </span>
                  </span>
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </header>
  );
}

const initialsOf = (name: string) =>
  name
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((part) => part.length > 1 && part[0] === part[0]!.toLocaleUpperCase('sk'))
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('sk') || '?';

/**
 * Files the e-mail under an organization and optionally the person who wrote. Either the
 * organization is found and then its person picked (the one with the sender's address first), or
 * the person is found and then one of their organizations (the primary one first).
 */
function AssignDialog({
  inboundId,
  fromEmail,
  current,
  onClose,
}: {
  inboundId: string;
  fromEmail: string;
  current: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(current);
  const [person, setPerson] = useState<{
    id: string;
    name: string;
    organizations: { id: string; name: string }[];
  } | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const term = search.trim();
  const found = useQuery({
    ...trpc.customer.list.queryOptions({ search: term || undefined, pageSize: 6 }),
    enabled: term.length >= 2,
  });
  const foundPeople = useQuery({
    ...trpc.person.list.queryOptions({ search: term || undefined, pageSize: 6 }),
    enabled: term.length >= 2,
  });
  // A private person is found as a person; the organizations list shows companies only.
  const companies = (found.data?.items ?? []).filter((row) => row.kind === 'organization');
  const customer = useQuery({
    ...trpc.customer.get.queryOptions({ id: picked?.id ?? '' }),
    enabled: picked !== null && person === null,
  });
  const people = customer.data?.kind === 'organization' ? customer.data.contacts : [];
  // The person with the sender's address, once the organization is loaded.
  useEffect(() => {
    if (person) return;
    const loaded = customer.data?.kind === 'organization' ? customer.data.contacts : [];
    const writer = loaded.find((p) => p.email?.toLowerCase() === fromEmail);
    setContactId(writer?.id ?? null);
  }, [customer.data, fromEmail, person]);
  const assign = useMutation(
    trpc.inbound.assign.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.inbound.pathFilter());
        await queryClient.invalidateQueries(trpc.activity.timeline.pathFilter());
        toast('success', t.assigned);
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const d = t.assignDialog;
  const row = (
    key: string,
    active: boolean,
    onPick: (() => void) | null,
    icon: ReactNode,
    label: string,
    note: string,
  ) => (
    <li key={key}>
      <button
        type="button"
        aria-pressed={active}
        disabled={!onPick}
        onClick={onPick ?? undefined}
        className={cn(
          'flex h-10 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-hover disabled:opacity-50',
          active && 'bg-primary-soft font-semibold text-primary-text',
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
        <span className="ml-auto shrink-0 truncate text-xs text-muted">{note}</span>
      </button>
    </li>
  );
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            aria-label={d.search}
            placeholder={d.search}
            value={search}
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
          />
          {term.length >= 2 ? (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border-subtle">
              {companies.length > 0 ? (
                <>
                  <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">
                    {d.organizations}
                  </p>
                  <ul>
                    {companies.map((o) =>
                      row(
                        o.id,
                        person === null && picked?.id === o.id,
                        () => {
                          setPerson(null);
                          setPicked({ id: o.id, name: o.name });
                        },
                        <Building2 className="size-4 shrink-0 text-muted" aria-hidden />,
                        o.name,
                        o.city ?? '',
                      ),
                    )}
                  </ul>
                </>
              ) : null}
              {(foundPeople.data?.items ?? []).length > 0 ? (
                <>
                  <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">{d.persons}</p>
                  <ul>
                    {(foundPeople.data?.items ?? []).map((p) => {
                      const name = personName(p);
                      const home = p.organizations[0];
                      return row(
                        p.id,
                        person?.id === p.id,
                        home
                          ? () => {
                              setPerson({ id: p.id, name, organizations: p.organizations });
                              setPicked({ id: home.id, name: home.name });
                              setContactId(p.id);
                            }
                          : null,
                        <UserRound className="size-4 shrink-0 text-muted" aria-hidden />,
                        name,
                        home ? (p.email ?? '') : d.noOrganization,
                      );
                    })}
                  </ul>
                </>
              ) : null}
              {found.isSuccess &&
              foundPeople.isSuccess &&
              companies.length === 0 &&
              foundPeople.data.items.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-muted">{d.nothing}</p>
              ) : null}
            </div>
          ) : null}
          {person && picked ? (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">
                {person.name}
                {person.organizations.length > 1 ? ` · ${d.organization}` : ` · ${picked.name}`}
              </legend>
              {person.organizations.length > 1
                ? person.organizations.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="organization"
                        checked={picked.id === o.id}
                        onChange={() => setPicked({ id: o.id, name: o.name })}
                      />
                      {o.name}
                    </label>
                  ))
                : null}
            </fieldset>
          ) : picked ? (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">
                {picked.name}
                {people.length > 0 ? ` · ${d.person}` : ''}
              </legend>
              {people.length > 0
                ? [
                    { id: null, label: d.noPerson },
                    ...people.map((p) => ({ id: p.id, label: personName(p) })),
                  ].map((option) => (
                    <label key={option.id ?? 'none'} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="contact"
                        checked={contactId === option.id}
                        onChange={() => setContactId(option.id)}
                      />
                      {option.label}
                    </label>
                  ))
                : null}
            </fieldset>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={!picked || assign.isPending}
            onClick={() =>
              picked && assign.mutate({ id: inboundId, customerId: picked.id, contactId })
            }
          >
            {d.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** „Odpovedať“: the answer's own text; the received e-mail is quoted below it when it leaves. */
type ThreadItem = RouterOutputs['inbound']['thread'][number];

/**
 * The rest of the conversation under the newest e-mail, as Gmail shows it: each one a row (who,
 * to whom, its first words, when), opened in place with a click; „Rozbaliť všetky“ opens them all.
 */
/**
 * Beside the e-mail: the other conversations with the same person, newest first. One opens in
 * place of this one; „‹ Späť na …“ in the header returns here.
 */
function OtherConversations({ inboundId, who }: { inboundId: string; who: string }) {
  const others = useQuery(trpc.inbound.others.queryOptions({ id: inboundId }));
  const items = others.data ?? [];
  if (items.length === 0) return null;
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader
        title={
          <>
            {t.others.title}
            <span className="ml-1.5 font-normal text-muted">· {items.length}</span>
          </>
        }
      />
      <p className="px-5 pt-1 pb-3 text-xs text-muted">{t.others.hint(who)}</p>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="border-t border-border-subtle">
            <Link
              to="/emails/inbox/$inboundId"
              params={{ inboundId: item.id }}
              className="block px-5 py-3 hover:bg-primary-soft/60"
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {item.subject || t.noSubject}
                </span>
                {item.inThread > 1 ? (
                  <span className="shrink-0 text-xs text-muted">{item.inThread}</span>
                ) : null}
                <span className="shrink-0 text-xs text-muted">{formatRecent(item.receivedAt)}</span>
              </span>
              {item.preview ? (
                <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">
                  {item.preview}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OlderInThread({ items }: { items: ThreadItem[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = open.size === items.length;
  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section aria-label={t.thread.older(items.length)} className="border-t border-border-subtle">
      <div className="flex items-center px-5 pt-3 pb-1.5">
        <p className="text-xs font-semibold text-muted">{t.thread.older(items.length)}</p>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setOpen(all ? new Set() : new Set(items.map((item) => item.id)))}
        >
          {all ? t.thread.collapseAll : t.thread.expandAll}
        </Button>
      </div>
      <ul>
        {items.map((item) => {
          const expanded = open.has(item.id);
          return (
            <li key={item.id} className="border-t border-border-subtle">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggle(item.id)}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-hover"
              >
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    item.kind === 'sent'
                      ? 'bg-primary-soft text-primary-text'
                      : 'bg-warning-soft text-warning',
                  )}
                >
                  {initialsOf(item.who)}
                </span>
                <span className="w-56 shrink-0 text-sm">
                  <span className="block truncate font-semibold">
                    {item.who}
                    {item.kind === 'sent' ? (
                      <span className="ml-1.5 rounded-full bg-info-soft px-1.5 text-[11px] font-semibold text-info">
                        {t.thread.sent}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted">{t.toLine(item.to)}</span>
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {expanded ? null : item.text.replace(/\s+/g, ' ').slice(0, 200)}
                </span>
                {item.attachments > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted">
                    <Paperclip className="size-3" aria-hidden />
                    {item.attachments}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs whitespace-nowrap text-muted">
                  {formatDateTime(item.at)}
                </span>
              </button>
              {expanded ? (
                <pre className="px-5 pb-4 pl-16 font-sans text-sm whitespace-pre-wrap">
                  {item.text}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
