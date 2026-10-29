import { sk } from '@intra/shared/i18n';
import { PAGE_SIZE, PERSON_EMAIL_STATES, PERSON_LINKS, PERSON_SORTS } from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { CustomerAvatar, MultiFilterMenu } from '@/components/customers/customer-bits';
import { BarButton, useDebounced } from '@/components/customers/organization-list';
import { OrganizationsHeader } from '@/components/customers/organizations-header';
import { PersonDialog } from '@/components/customers/person-dialog';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { TablePagination, TableShell } from '@/components/table-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RowLink, TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const p = sk.organizations.persons;
const PAGE_SIZES = [20, 50, 100] as const;

const search = z.object({
  q: z.string().optional(),
  link: z.array(z.enum(PERSON_LINKS)).optional(),
  organization: z.array(z.string()).optional(),
  emailState: z.array(z.enum(PERSON_EMAIL_STATES)).optional(),
  sort: z.enum(PERSON_SORTS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).optional(),
  size: z.union([z.literal(20), z.literal(50), z.literal(100)]).optional(),
});
type PersonSearch = z.infer<typeof search>;

export const Route = createFileRoute('/_app/organizations/contacts')({
  validateSearch: search,
  component: ContactsTab,
});

type Row = RouterOutputs['person']['list']['items'][number];

/** Organizácie › Kontakty: every person, with where they work. */
function ContactsTab() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const toast = useToast();
  const [typed, setTyped] = useState(params.q ?? '');
  const debounced = useDebounced(typed.trim(), 300);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const canSend = useCan('email.send');
  const canWrite = useCan('customer.write');
  const [creating, setCreating] = useState(false);

  const setSearch = (next: Partial<PersonSearch>, keepPage = false) =>
    void navigate({
      search: (prev) => {
        const merged: Record<string, unknown> = { ...prev, ...next };
        if (!keepPage) delete merged.page;
        for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
        return merged;
      },
      replace: true,
    });
  useEffect(() => {
    if ((params.q ?? '') !== debounced) setSearch({ q: debounced || undefined });
    // Only the typed text drives this; the address follows it.
  }, [debounced]);

  const list = useQuery({
    ...trpc.person.list.queryOptions({
      search: params.q,
      link: params.link,
      organizationId: params.organization,
      emailState: params.emailState,
      sort: params.sort ?? 'name',
      dir: params.dir ?? 'asc',
      page: params.page ?? 1,
      pageSize: params.size ?? PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });
  const organizations = useQuery(trpc.customer.list.queryOptions({ pageSize: 100, sort: 'name' }));
  const rows = list.data?.items ?? [];
  const counts = list.data?.counts;

  // An e-mail goes to a person at an organization: the persons' organizations are the recipients.
  const compose = useMutation(
    trpc.campaign.create.mutationOptions({
      onSuccess: (created) =>
        navigate({ to: '/emails/compose/$campaignId', params: { campaignId: created.id } }),
      onError: (error) => toast('error', errorMessage(error, sk.campaigns.errors)),
    }),
  );
  const pickedOrganizations = [
    ...new Set(
      rows
        .filter((row) => selected.has(row.id))
        .flatMap((row) => row.organizations.map((o) => o.id)),
    ),
  ];

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (allOnPage) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const filtered = Boolean(params.q || params.link || params.organization || params.emailState);

  const sortHeader = (key: (typeof PERSON_SORTS)[number], label: string) => {
    const active = (params.sort ?? 'name') === key;
    const dir = params.dir ?? 'asc';
    const Arrow = dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 uppercase"
        onClick={() =>
          setSearch({
            sort: key,
            dir: active ? (dir === 'asc' ? 'desc' : 'asc') : key === 'lastContact' ? 'desc' : 'asc',
          })
        }
      >
        {label}
        {active ? <Arrow className="size-3" aria-hidden /> : null}
      </button>
    );
  };
  const sortState = (key: string) =>
    (params.sort ?? 'name') === key
      ? (params.dir ?? 'asc') === 'asc'
        ? ('ascending' as const)
        : ('descending' as const)
      : undefined;

  return (
    <div className="min-w-0">
      <OrganizationsHeader active="contacts">
        {canWrite ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {sk.organizations.newPerson}
          </Button>
        ) : null}
      </OrganizationsHeader>
      <div className="max-w-[1400px] px-7 pt-5 pb-10">
        <TableShell
          header={
            <div>
              <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-4">
                <label className="flex h-10 max-w-[420px] min-w-0 flex-[1_1_320px] items-center gap-2 rounded-[10px] border border-border bg-white px-3 focus-within:border-primary">
                  <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
                  <span className="sr-only">{p.searchLabel}</span>
                  <input
                    type="search"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder={p.searchPlaceholder}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <MultiFilterMenu
                    label={p.link}
                    values={params.link}
                    options={PERSON_LINKS.map((key) => ({
                      value: key,
                      label: p.links[key],
                      count: counts?.[key],
                    }))}
                    onChange={(link) => setSearch({ link })}
                  />
                  <MultiFilterMenu
                    label={p.organization}
                    values={params.organization}
                    options={(organizations.data?.items ?? []).map((org) => ({
                      value: org.id,
                      label: org.name,
                    }))}
                    onChange={(organization) => setSearch({ organization })}
                  />
                  <MultiFilterMenu
                    label={p.emailState}
                    values={params.emailState}
                    options={PERSON_EMAIL_STATES.map((key) => ({
                      value: key,
                      label: p.emailStates[key],
                    }))}
                    onChange={(emailState) => setSearch({ emailState })}
                  />
                </div>
              </div>
              {selected.size > 0 ? (
                <div className="mx-3 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-dark py-2 pr-2 pl-4 text-white">
                  <span className="mr-auto text-sm font-semibold">{p.selected(selected.size)}</span>
                  {canSend && pickedOrganizations.length > 0 ? (
                    <BarButton onClick={() => compose.mutate({ customerIds: pickedOrganizations })}>
                      {sk.campaigns.sendEmail}
                    </BarButton>
                  ) : null}
                  <BarButton onClick={() => setSelected(new Set())}>
                    {sk.customers.bulk.clear}
                  </BarButton>
                </div>
              ) : null}
            </div>
          }
          columns={[
            <Checkbox
              key="all"
              aria-label={sk.customers.columns.selectAll}
              checked={allOnPage}
              onChange={toggleAll}
            />,
            sortHeader('name', p.columns.person),
            p.columns.organizations,
            p.columns.contact,
            sortHeader('lastContact', p.columns.lastContact),
          ]}
          columnClassNames={[
            'w-10',
            undefined,
            'hidden md:table-cell',
            'hidden lg:table-cell',
            'hidden xl:table-cell',
          ]}
          columnSort={[
            undefined,
            sortState('name'),
            undefined,
            undefined,
            sortState('lastContact'),
          ]}
          loading={list.isPending}
          refreshing={list.isPlaceholderData}
          message={
            loadFailed(list) ? (
              <ErrorState onRetry={() => void list.refetch()} />
            ) : list.data && rows.length === 0 ? (
              <EmptyState
                compact
                title={filtered ? sk.customers.noResults.title : p.empty.title}
                text={filtered ? sk.customers.noResults.text : p.empty.text}
              />
            ) : null
          }
          footer={
            list.data ? (
              <TablePagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                onPageChange={(page) => setSearch({ page }, true)}
                pageSizes={PAGE_SIZES}
                onPageSizeChange={(size) => setSearch({ size: size as 20 | 50 | 100 })}
              />
            ) : null
          }
        >
          {rows.map((row) => (
            <PersonRow
              key={row.id}
              row={row}
              checked={selected.has(row.id)}
              onToggle={() => toggle(row.id)}
            />
          ))}
        </TableShell>
      </div>
      {creating ? <PersonDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function PersonRow({
  row,
  checked,
  onToggle,
}: {
  row: Row;
  checked: boolean;
  onToggle: () => void;
}) {
  const flag = row.unsubscribedAt
    ? { tone: 'neutral' as const, text: p.unsubscribed }
    : row.emailStatus !== 'ok'
      ? { tone: 'danger' as const, text: p.invalid }
      : null;
  return (
    <TableRow href={`/contacts/${row.id}`} className={cn(checked && 'bg-primary-soft/40')}>
      <TableCell className="w-10">
        <Checkbox
          aria-label={`${sk.customers.columns.select} ${row.name}`}
          checked={checked}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <CustomerAvatar name={row.name} kind="individual" />
          <div className="min-w-0">
            <RowLink href={`/contacts/${row.id}`} className="block truncate font-semibold">
              {row.name}
            </RowLink>
            {flag ? (
              <Badge tone={flag.tone} className="mt-0.5">
                {flag.text}
              </Badge>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {row.organizations.length === 0 ? (
          <span className="text-[13px] text-muted">{p.noOrganization}</span>
        ) : (
          <div className="flex flex-col gap-1">
            {row.organizations.map((org) => (
              <div
                key={org.id}
                className="flex flex-wrap items-center gap-1.5 text-[13px] leading-5"
              >
                <span
                  className={cn(
                    'inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap',
                    org.kind === 'individual'
                      ? 'border border-border-subtle bg-subtle text-muted'
                      : org.role === 'customer'
                        ? 'bg-primary-soft text-primary-text'
                        : 'bg-info-soft text-info',
                  )}
                >
                  {org.kind === 'individual' ? p.self(p.roles[org.role]) : p.roles[org.role]}
                </span>
                {org.kind === 'individual' ? null : (
                  <Link
                    to="/customers/$customerId"
                    params={{ customerId: org.id }}
                    className="font-semibold text-primary-text hover:underline"
                  >
                    {org.name}
                  </Link>
                )}
                {org.position ? <span className="text-muted">{org.position}</span> : null}
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <p className="truncate text-[13px]">{row.email ?? sk.common.none}</p>
        <p className="truncate text-xs text-muted">{row.phone}</p>
      </TableCell>
      <TableCell className="hidden text-muted xl:table-cell">
        {row.lastContactAt ? formatDate(row.lastContactAt) : sk.common.none}
      </TableCell>
    </TableRow>
  );
}
