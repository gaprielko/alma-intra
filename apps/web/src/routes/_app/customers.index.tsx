import { sk } from '@intra/shared/i18n';
import {
  CUSTOMER_KINDS,
  CUSTOMER_SORTS,
  CUSTOMER_STATUSES,
  type CustomerFilter,
  PAGE_SIZE,
  type CustomerStatus,
  REGIONS,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Download, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  CustomerAvatar,
  CustomerStatusBadge,
  FilterMenu,
  TagChip,
} from '@/components/customers/customer-bits';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { TablePagination, TableShell } from '@/components/table-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { RowLink, TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { datedFilename, downloadText } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.customers;
/** How many customers a page shows, as a person chooses it. */
const PAGE_SIZES = [20, 50, 100] as const;

const search = z.object({
  q: z.string().optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  kind: z.enum(CUSTOMER_KINDS).optional(),
  type: z.string().optional(),
  region: z.enum(REGIONS).optional(),
  tag: z.string().optional(),
  owner: z.string().optional(),
  sort: z.enum(CUSTOMER_SORTS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).optional(),
  size: z.union([z.literal(20), z.literal(50), z.literal(100)]).optional(),
});
type ListSearch = z.infer<typeof search>;

export const Route = createFileRoute('/_app/customers/')({
  validateSearch: search,
  component: CustomersPage,
});

type Row = RouterOutputs['customer']['list']['items'][number];

/** The search box writes to the address a moment after the last key, not on every key. */
function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function CustomersPage() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const toast = useToast();
  const [typed, setTyped] = useState(params.q ?? '');
  const debounced = useDebounced(typed.trim(), 300);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<'tag' | 'status' | null>(null);

  const setSearch = (next: Partial<ListSearch>, keepPage = false) =>
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

  const filter = {
    search: params.q,
    status: params.status,
    kind: params.kind,
    typeId: params.type,
    region: params.region,
    tagId: params.tag,
    ownerUserId: params.owner,
  };
  /** The filters that are set, as the API takes them. */
  const activeFilter = Object.fromEntries(
    Object.entries(filter).filter(([, v]) => v !== undefined),
  ) as CustomerFilter;
  const input = {
    ...activeFilter,
    sort: params.sort ?? 'name',
    dir: params.dir ?? 'asc',
    page: params.page ?? 1,
    pageSize: params.size ?? PAGE_SIZE,
  } as Parameters<typeof trpc.customer.list.queryOptions>[0];
  const list = useQuery({
    ...trpc.customer.list.queryOptions(input),
    placeholderData: keepPreviousData,
  });
  const options = useQuery(trpc.customer.options.queryOptions());
  const canSend = useCan('email.send');
  const compose = useMutation(
    trpc.campaign.create.mutationOptions({
      onSuccess: (created) =>
        navigate({ to: '/emails/compose/$campaignId', params: { campaignId: created.id } }),
      onError: (error) => toast('error', errorMessage(error, sk.campaigns.errors)),
    }),
  );

  const exportCsv = useMutation(
    trpc.customer.exportCsv.mutationOptions({
      onSuccess: (answer) => {
        downloadText(datedFilename('zakaznici', 'csv'), answer.csv);
        toast('success', t.exported);
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );

  const rows = list.data?.items ?? [];
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

  const filtered = Object.values(filter).some((v) => v !== undefined && v !== params.status);
  const counts = list.data?.counts;
  const typeOptions = useMemo(
    () => [
      ...(options.data?.types ?? []).map((type) => ({ value: type.id, label: type.name })),
      { value: 'none', label: t.filters.noType },
    ],
    [options.data],
  );

  const sortHeader = (key: (typeof CUSTOMER_SORTS)[number], label: string) => {
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
            // The most recent contact first on the first click; names and states A to Z.
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
      <PageHeader
        title={t.title}
        subtitle={counts ? t.subtitle(counts.all, counts.customer) : undefined}
      >
        <Button
          variant="secondary"
          disabled={exportCsv.isPending || !counts?.all}
          onClick={() => exportCsv.mutate(activeFilter)}
        >
          <Download className="size-4" aria-hidden />
          {t.exportAll}
        </Button>
        <Button asChild>
          <Link to="/customers/new">
            <Plus className="size-4" aria-hidden />
            {t.new}
          </Link>
        </Button>
      </PageHeader>

      <div className="max-w-[1400px] px-7 pt-5 pb-10">
        <TableShell
          header={
            <div>
              <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
                <label className="flex h-10 max-w-[420px] min-w-0 flex-[1_1_320px] items-center gap-2 rounded-[10px] border border-border bg-white px-3 focus-within:border-primary">
                  <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
                  <span className="sr-only">{t.searchLabel}</span>
                  <input
                    type="search"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <FilterMenu
                    label={t.filters.kind}
                    value={params.kind}
                    options={CUSTOMER_KINDS.map((k) => ({ value: k, label: t.kind[k] }))}
                    onChange={(kind) => setSearch({ kind })}
                  />
                  <FilterMenu
                    label={t.filters.type}
                    value={params.type}
                    options={typeOptions}
                    onChange={(type) => setSearch({ type })}
                  />
                  <FilterMenu
                    label={t.filters.region}
                    value={params.region}
                    options={REGIONS.map((r) => ({ value: r, label: t.region[r] }))}
                    onChange={(region) => setSearch({ region })}
                  />
                  <FilterMenu
                    label={t.filters.tag}
                    value={params.tag}
                    options={(options.data?.tags ?? []).map((tag) => ({
                      value: tag.id,
                      label: tag.name,
                    }))}
                    onChange={(tag) => setSearch({ tag })}
                  />
                  <FilterMenu
                    label={t.filters.owner}
                    value={params.owner}
                    options={(options.data?.users ?? []).map((u) => ({
                      value: u.id,
                      label: u.name,
                    }))}
                    onChange={(owner) => setSearch({ owner })}
                  />
                </div>
              </div>
              <div
                className="flex flex-wrap gap-2 px-5 pt-3.5 pb-4"
                role="group"
                aria-label={t.columns.status}
              >
                {(['all', ...CUSTOMER_STATUSES] as const).map((key) => {
                  const on = (params.status ?? 'all') === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSearch({ status: key === 'all' ? undefined : key })}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
                        on
                          ? 'border-primary bg-primary-soft font-semibold text-primary-text'
                          : 'border-border bg-white hover:bg-hover',
                      )}
                    >
                      {t.chips[key]}
                      {counts ? (
                        <span className="tabular-nums opacity-70">· {counts[key]}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {selected.size > 0 ? (
                <div className="mx-3 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-dark py-2 pr-2 pl-4 text-white">
                  <span className="mr-auto text-sm font-semibold">
                    {t.bulk.selected(selected.size)}
                  </span>
                  {canSend ? (
                    <BarButton onClick={() => compose.mutate({ customerIds: [...selected] })}>
                      {sk.campaigns.sendEmail}
                    </BarButton>
                  ) : null}
                  <BarButton onClick={() => setDialog('tag')}>{t.bulk.addTag}</BarButton>
                  <BarButton onClick={() => setDialog('status')}>{t.bulk.changeStatus}</BarButton>
                  <BarButton
                    disabled={exportCsv.isPending}
                    onClick={() => exportCsv.mutate({ ids: [...selected] })}
                  >
                    {t.bulk.exportCsv}
                  </BarButton>
                  <BarButton onClick={() => setSelected(new Set())}>{t.bulk.clear}</BarButton>
                </div>
              ) : null}
            </div>
          }
          columns={[
            <Checkbox
              key="all"
              aria-label={t.columns.selectAll}
              checked={allOnPage}
              onChange={toggleAll}
            />,
            sortHeader('name', t.columns.customer),
            t.columns.primaryContact,
            sortHeader('status', t.columns.status),
            t.columns.owner,
            t.columns.tags,
            sortHeader('lastContact', t.columns.lastContact),
          ]}
          columnClassNames={[
            'w-10',
            undefined,
            'hidden lg:table-cell',
            undefined,
            'hidden xl:table-cell',
            'hidden 2xl:table-cell',
            'hidden xl:table-cell',
          ]}
          columnSort={[
            undefined,
            sortState('name'),
            undefined,
            sortState('status'),
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
                title={filtered || params.status ? t.noResults.title : t.empty.title}
                text={filtered || params.status ? t.noResults.text : t.empty.text}
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
            <CustomerRow
              key={row.id}
              row={row}
              checked={selected.has(row.id)}
              onToggle={() => toggle(row.id)}
            />
          ))}
        </TableShell>
      </div>

      {dialog === 'tag' ? (
        <BulkTagDialog
          ids={[...selected]}
          tags={options.data?.tags.map((tag) => tag.name) ?? []}
          onClose={(done) => {
            setDialog(null);
            if (done) setSelected(new Set());
          }}
        />
      ) : null}
      {dialog === 'status' ? (
        <BulkStatusDialog
          ids={[...selected]}
          onClose={(done) => {
            setDialog(null);
            if (done) setSelected(new Set());
          }}
        />
      ) : null}
    </div>
  );
}

function BarButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center rounded-lg bg-white/12 px-3 text-[13px] font-semibold whitespace-nowrap hover:bg-white/20 disabled:opacity-50"
      {...props}
    >
      {children}
    </button>
  );
}

function CustomerRow({
  row,
  checked,
  onToggle,
}: {
  row: Row;
  checked: boolean;
  onToggle: () => void;
}) {
  const href = `/customers/${row.id}`;
  const meta = [
    row.city,
    row.kind === 'individual' ? t.kind.individual : (row.typeName ?? t.filters.noType),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <TableRow href={href} className={cn(checked && 'bg-primary-soft/40')}>
      <TableCell className="w-10">
        <Checkbox
          aria-label={`${t.columns.select} ${row.name}`}
          checked={checked}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <CustomerAvatar name={row.name} kind={row.kind} />
          <div className="min-w-0">
            <RowLink href={href} className="block truncate font-semibold">
              {row.name}
            </RowLink>
            <p className="truncate text-xs text-muted">{meta}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        {row.primaryContact ? (
          <>
            <p className="truncate">{row.primaryContact.name}</p>
            <p className="truncate text-xs text-muted">{row.primaryContact.email}</p>
          </>
        ) : (
          <>
            <p className="text-muted">{t.noContact}</p>
            <p className="text-xs font-semibold text-warning">{t.addContactHint}</p>
          </>
        )}
      </TableCell>
      <TableCell>
        <CustomerStatusBadge status={row.status} />
      </TableCell>
      <TableCell className="hidden text-muted xl:table-cell">
        {row.owner?.name ?? sk.common.none}
      </TableCell>
      <TableCell className="hidden 2xl:table-cell">
        <div className="flex flex-wrap gap-1">
          {row.tags.map((tag) => (
            <TagChip key={tag.id}>{tag.name}</TagChip>
          ))}
        </div>
      </TableCell>
      <TableCell className="hidden text-muted xl:table-cell">
        {row.lastContactAt ? formatDate(row.lastContactAt) : sk.common.none}
      </TableCell>
    </TableRow>
  );
}

function BulkTagDialog({
  ids,
  tags,
  onClose,
}: {
  ids: string[];
  tags: string[];
  onClose: (done: boolean) => void;
}) {
  const d = t.bulk.tagDialog;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tag, setTag] = useState('');
  const add = useMutation(
    trpc.customer.bulkAddTag.mutationOptions({
      onSuccess: async (answer) => {
        toast('success', d.done(answer.count));
        await queryClient.invalidateQueries(trpc.customer.pathFilter());
        onClose(true);
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (tag.trim()) add.mutate({ ids, tag: tag.trim() });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="bulk-tag">{d.field}</Label>
            <Input
              id="bulk-tag"
              list="bulk-tag-options"
              maxLength={40}
              autoComplete="off"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
            />
            <datalist id="bulk-tag-options">
              {tags.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={add.isPending || !tag.trim()}>
              {d.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BulkStatusDialog({ ids, onClose }: { ids: string[]; onClose: (done: boolean) => void }) {
  const d = t.bulk.statusDialog;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CustomerStatus>('contacted');
  const change = useMutation(
    trpc.customer.bulkSetStatus.mutationOptions({
      onSuccess: async (answer) => {
        toast('success', d.done(answer.count));
        await queryClient.invalidateQueries(trpc.customer.pathFilter());
        onClose(true);
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            change.mutate({ ids, status });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="bulk-status">{d.field}</Label>
            <Select
              id="bulk-status"
              value={status}
              onChange={(v) => setStatus(v as CustomerStatus)}
            >
              {CUSTOMER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t.status[s]}
                </SelectItem>
              ))}
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {d.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
