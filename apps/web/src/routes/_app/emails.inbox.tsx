import { sk } from '@intra/shared/i18n';
import { INBOUND_VIEWS } from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Paperclip, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useDebounced } from '@/components/customers/organization-list';
import { PersonDialog } from '@/components/customers/person-dialog';
import { type ContactPick, ContactSearch } from '@/components/emails/contact-search';
import { NewEmailButton } from '@/components/emails/new-email-button';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { TablePagination, TableShell } from '@/components/table-shell';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RowLink, TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.inbound;

/** How often an open „Prijaté“ asks for new e-mail on its own. */
const REFRESH_MS = 30_000;

export const Route = createFileRoute('/_app/emails/inbox')({
  validateSearch: z.object({
    view: z.enum(INBOUND_VIEWS).optional(),
    q: z.string().optional(),
    /** The contact filter: an organization (with its prevádzky) or a person, and its name. */
    customer: z.string().uuid().optional(),
    contact: z.string().uuid().optional(),
    who: z.string().optional(),
    att: z.boolean().optional(),
  }),
  component: InboxPage,
});

/** „Prijaté“: received e-mail, all of it first, „Nepriradené“ a click away; one opens on its own page. */
function InboxPage() {
  const params = Route.useSearch();
  const { view = 'all' } = params;
  const navigate = useNavigate({ from: Route.fullPath });
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState(params.q ?? '');
  const search = useDebounced(typed.trim(), 300);
  const [picking, setPicking] = useState(false);
  // Any change of the filters or the search starts on the first page, and is kept in the address.
  const setFilters = (next: Partial<typeof params>) => {
    setPage(1);
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  };
  useEffect(() => {
    if ((params.q ?? '') !== search) setFilters({ q: search || undefined });
    // Only the debounced text drives the address.
  }, [search]);
  const filtered = Boolean(params.q || params.customer || params.contact || params.att);
  const list = useQuery({
    ...trpc.inbound.list.queryOptions({
      view,
      page,
      ...(params.q ? { search: params.q } : {}),
      ...(params.customer ? { customerId: params.customer } : {}),
      ...(params.contact ? { contactId: params.contact } : {}),
      ...(params.att ? { withAttachments: true } : {}),
    }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const rows = list.data?.items ?? [];
  const toast = useToast();
  const queryClient = useQueryClient();
  const sync = useMutation(
    trpc.inbound.sync.mutationOptions({
      onSuccess: async ({ added }) => {
        toast('success', t.synced(added));
        await queryClient.invalidateQueries(trpc.inbound.pathFilter());
      },
      onError: (error) =>
        toast(
          'error',
          errorMessage(error, {
            not_configured: t.syncNotConfigured,
            provider_refused: t.syncRefused,
          }),
        ),
    }),
  );
  // Every 30 s, while the page is in view, take in what the webhook may have missed, quietly:
  // only new e-mails are told, a failure waits for the next round or „Načítať nové“.
  const autoSync = useMutation(
    trpc.inbound.sync.mutationOptions({
      onSuccess: async ({ added }) => {
        if (added === 0) return;
        toast('success', t.synced(added));
        await queryClient.invalidateQueries(trpc.inbound.pathFilter());
      },
    }),
  );
  const { mutate: syncQuietly } = autoSync;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') syncQuietly();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [syncQuietly]);
  const chip = (key: (typeof INBOUND_VIEWS)[number], label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={view === key}
      onClick={() => setFilters({ view: key === 'all' ? undefined : key })}
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
        view === key
          ? 'border-primary bg-primary-soft font-semibold text-primary-text'
          : 'border-border bg-white hover:bg-hover',
      )}
    >
      {label}
    </button>
  );
  return (
    <main className="max-w-[1440px] space-y-4 px-7 pt-5 pb-10">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 w-full max-w-md items-center gap-2 rounded-[10px] border border-border bg-white px-3 focus-within:border-primary">
          <Search className="size-[15px] shrink-0 text-tertiary" aria-hidden />
          <span className="sr-only">{t.filters.search}</span>
          <input
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={t.filters.search}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-tertiary"
          />
        </label>
        {params.customer || params.contact ? (
          <span className="inline-flex h-8 items-center gap-1 rounded-full border border-primary bg-primary-soft pr-1 pl-3 text-[13px] font-semibold text-primary-text">
            {params.who}
            <button
              type="button"
              aria-label={t.filters.clear(params.who ?? '')}
              onClick={() =>
                setFilters({ customer: undefined, contact: undefined, who: undefined })
              }
              className="inline-flex size-6 items-center justify-center rounded-full hover:bg-white/60"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ) : (
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-white px-3 text-[13px] font-medium hover:bg-hover"
              >
                {t.filters.contact}
                <ChevronDown className="size-3.5" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent>
              <ContactSearch
                onPick={(pick) => {
                  setPicking(false);
                  setFilters(
                    pick.kind === 'person'
                      ? { contact: pick.id, customer: undefined, who: pick.name }
                      : { customer: pick.id, contact: undefined, who: pick.name },
                  );
                }}
              />
            </PopoverContent>
          </Popover>
        )}
        <button
          type="button"
          aria-pressed={Boolean(params.att)}
          onClick={() => setFilters({ att: params.att ? undefined : true })}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium',
            params.att
              ? 'border-primary bg-primary-soft font-semibold text-primary-text'
              : 'border-border bg-white hover:bg-hover',
          )}
        >
          <Paperclip className="size-3.5" aria-hidden />
          {t.filters.withAttachments}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div role="group" aria-label={t.views.label} className="flex gap-2">
          {chip('all', t.views.all)}
          {chip('unassigned', t.views.unassigned(list.data?.unassigned ?? 0))}
        </div>
        <span className="ml-auto" />
        <NewEmailButton size="sm" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={cn('size-3.5', sync.isPending && 'animate-spin')} aria-hidden />
          {t.sync}
        </Button>
      </div>
      {loadFailed(list) ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : list.data && rows.length === 0 && page === 1 ? (
        <EmptyState
          title={
            filtered
              ? t.filters.emptyFiltered
              : view === 'unassigned'
                ? t.emptyUnassigned
                : t.emptyAll
          }
        />
      ) : (
        <TableShell
          columns={[t.columns.from, t.columns.subject, t.columns.contact, t.columns.received]}
          columnClassNames={[undefined, undefined, 'hidden lg:table-cell', undefined]}
          loading={list.isPending}
          refreshing={list.isPlaceholderData}
          footer={
            <TablePagination page={page} total={list.data?.total ?? 0} onPageChange={setPage} />
          }
        >
          {rows.map((row) => (
            <TableRow key={row.id} href={`/emails/inbox/${row.id}`}>
              <TableCell className="max-w-56">
                {/* Filed under a person: their name from Kontakty, the address under it. */}
                <RowLink href={`/emails/inbox/${row.id}`} className="block truncate font-semibold">
                  {row.contactName || row.fromName || row.fromEmail}
                  {/* A conversation: „, ja“ when ours are in it, and how many e-mails it holds. */}
                  {row.ours > 0 ? (
                    <span className="font-normal text-muted">{t.thread.me}</span>
                  ) : null}
                  {row.inThread > 1 ? (
                    <span className="ml-1.5 rounded-full bg-track px-1.5 text-[11px] font-bold text-muted">
                      {row.inThread}
                    </span>
                  ) : null}
                </RowLink>
                {row.contactName || row.fromName ? (
                  <p className="truncate text-xs text-muted">{row.fromEmail}</p>
                ) : null}
              </TableCell>
              <TableCell className="max-w-[28rem]">
                <p className="truncate text-sm font-medium">{row.subject || t.noSubject}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                  {row.attachmentCount > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5">
                      <Paperclip className="size-3" aria-hidden />
                      {t.attachments(row.attachmentCount)}
                    </span>
                  ) : null}
                  <span className="truncate">{row.preview}</span>
                </p>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {row.status === 'unassigned' ? (
                  <QuickAssign
                    inboundId={row.id}
                    fromEmail={row.fromEmail}
                    from={row.fromName ?? row.fromEmail}
                  />
                ) : (
                  <span className="text-sm">{row.customerName}</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted">
                {formatRecent(row.receivedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableShell>
      )}
    </main>
  );
}

/**
 * „Nepriradené“ in a row: a click opens the search right away; picking an organization, a
 * prevádzka or a person files the e-mail there, or a new contact is made with the sender's address.
 */
function QuickAssign({
  inboundId,
  fromEmail,
  from,
}: {
  inboundId: string;
  fromEmail: string;
  from: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const assign = useMutation(
    trpc.inbound.assign.mutationOptions({
      onSuccess: async () => {
        toast('success', t.assigned);
        await Promise.all([
          queryClient.invalidateQueries(trpc.inbound.pathFilter()),
          queryClient.invalidateQueries(trpc.activity.timeline.pathFilter()),
        ]);
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const file = (customerId: string, contactId: string | null) =>
    assign.mutate({ id: inboundId, customerId, contactId });
  const pick = (picked: ContactPick) => {
    setOpen(false);
    if (picked.kind !== 'person') file(picked.id, null);
    else if (picked.organization) file(picked.organization.id, picked.id);
    else toast('warning', t.quickAssign.noOrganization);
  };
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t.quickAssign.open(from)}
            disabled={assign.isPending}
            className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning hover:brightness-95"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            {t.unassigned}
            <ChevronDown className="size-3" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end">
          <ContactSearch
            onPick={pick}
            footer={
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-primary-text hover:bg-hover"
              >
                + {t.quickAssign.newContact(fromEmail)}
              </button>
            }
          />
        </PopoverContent>
      </Popover>
      {creating ? (
        <PersonDialog
          initialEmail={fromEmail}
          onCreated={(created) => {
            if (created.customerId) file(created.customerId, created.id);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
