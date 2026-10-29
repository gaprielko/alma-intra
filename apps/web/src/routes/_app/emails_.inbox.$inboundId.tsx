import { sk } from '@intra/shared/i18n';
import { personName } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Building2, Paperclip, Reply, Trash2, UserRound } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { trpc } from '@/lib/trpc';
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
      <main className="grid max-w-[1440px] items-start gap-5 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-hidden">
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
        <Card className="space-y-4 p-5 text-sm">
          <Fact label={t.from}>
            <p className="font-medium">{m.fromName ?? m.fromEmail}</p>
            {m.fromName ? <p className="text-muted">{m.fromEmail}</p> : null}
          </Fact>
          <Fact label={t.to}>{m.toEmails.join(', ')}</Fact>
          <Fact label={t.received}>{formatDateTime(m.receivedAt)}</Fact>
          {m.original ? (
            <Fact label={t.answers}>
              <Link
                to="/emails/sent/$campaignId"
                params={{ campaignId: m.original.campaignId }}
                className="font-medium text-primary-text hover:underline"
              >
                {m.original.subject ?? t.noSubject}
              </Link>
            </Fact>
          ) : null}
          {m.customerId ? (
            <Fact label={t.filedUnder}>
              <Link
                to="/organizations/$customerId"
                params={{ customerId: m.customerId }}
                className="font-medium text-primary-text hover:underline"
              >
                {m.customerName}
              </Link>
              {m.contactName ? <p className="text-muted">{m.contactName}</p> : null}
            </Fact>
          ) : null}
          {m.attachments.length > 0 ? (
            <Fact label={t.attachments(m.attachments.length)}>
              <ul className="space-y-1.5">
                {m.attachments.map((file) => (
                  <li key={file.id} className="flex items-start gap-1.5">
                    <Paperclip className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
                    {file.fileId ? (
                      <button
                        type="button"
                        aria-label={t.download(file.filename)}
                        className="truncate text-left font-medium text-primary-text hover:underline"
                        onClick={() =>
                          void downloadFile(file.fileId!, file.filename).catch((error: unknown) =>
                            toast('error', errorMessage(error, sk.files.errors)),
                          )
                        }
                      >
                        {file.filename}
                      </button>
                    ) : (
                      <span className="min-w-0 text-muted">
                        <span className="block truncate">{file.filename}</span>
                        {file.skipped ? (
                          <span className="text-xs">{t.skipped[file.skipped]}</span>
                        ) : null}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                {m.customerId ? t.savedToFolder : t.notSavedYet}
              </p>
            </Fact>
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-0.5 break-words">{children}</div>
    </div>
  );
}

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
