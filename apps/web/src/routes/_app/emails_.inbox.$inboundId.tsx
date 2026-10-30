import { sk } from '@intra/shared/i18n';
import { personName } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Building2, ChevronDown, Paperclip, Reply, Trash2, UserRound } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Input, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
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
          ) : undefined
        }
      >
        {m.status === 'assigned' ? (
          <Button onClick={() => setReplying(true)}>
            <Reply className="size-4" aria-hidden />
            {t.reply}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => setAssigning(true)}>
          <Building2 className="size-4" aria-hidden />
          {m.status === 'unassigned' ? t.assign : t.reassign}
        </Button>
        <Button variant="ghost" onClick={() => setDiscarding(true)}>
          <Trash2 className="size-4" aria-hidden />
          {t.discard}
        </Button>
      </PageHeader>
      <main className="max-w-[1100px] px-7 py-6">
        <Card className="overflow-hidden">
          <MessageHeader message={m} />
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
        </Card>
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
function MessageHeader({ message: m }: { message: Message }) {
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
function ReplyDialog({
  inboundId,
  to,
  onClose,
}: {
  inboundId: string;
  to: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const send = useMutation(
    trpc.inbound.reply.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.activity.timeline.pathFilter());
        await queryClient.invalidateQueries(trpc.campaign.pathFilter());
        toast('success', t.replyDialog.sent);
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const d = t.replyDialog;
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title(to)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            aria-label={d.text}
            placeholder={d.text}
            rows={8}
            maxLength={10_000}
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="text-xs text-muted">{d.quoted}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={!text.trim() || send.isPending}
            onClick={() => send.mutate({ id: inboundId, text })}
          >
            {d.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
