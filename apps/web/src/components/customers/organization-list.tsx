import { sk } from '@intra/shared/i18n';
import {
  CUSTOMER_KINDS,
  CUSTOMER_SORTS,
  CUSTOMER_STATUSES,
  type CustomerStatus,
  type OrganizationRole,
  PAGE_SIZE,
  REGIONS,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Download, Plus, Search } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { ActivityDialog } from '@/components/activities/activity-dialog';
import {
  CustomerAvatar,
  CustomerStatusBadge,
  MultiFilterMenu,
  ProductChip,
  TagChip,
} from '@/components/customers/customer-bits';
import { OrganizationsHeader } from '@/components/customers/organizations-header';
import { SegmentsMenu } from '@/components/customers/segments-menu';
import { EmptyState, ErrorState } from '@/components/empty-state';
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
const o = sk.organizations;
/** How many records a page shows, as a person chooses it. */
const PAGE_SIZES = [20, 50, 100] as const;
const ids = z.array(z.string()).optional();

/** The address of a list: every dropdown filter takes several values (D-12). */
export const organizationSearch = z.object({
  q: z.string().optional(),
  status: z.array(z.enum([...CUSTOMER_STATUSES, 'none'])).optional(),
  kind: z.array(z.enum(CUSTOMER_KINDS)).optional(),
  product: ids,
  region: z.array(z.enum(REGIONS)).optional(),
  tag: ids,
  owner: ids,
  sort: z.enum(CUSTOMER_SORTS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).optional(),
  size: z.union([z.literal(20), z.literal(50), z.literal(100)]).optional(),
});
export type OrganizationSearch = z.infer<typeof organizationSearch>;

/** The address with these filters changed; a changed filter goes back to the first page. */
export const merge =
  (next: Partial<OrganizationSearch>, keepPage: boolean) => (prev: OrganizationSearch) => {
    const merged: Record<string, unknown> = { ...prev, ...next };
    if (!keepPage) delete merged.page;
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    return merged as OrganizationSearch;
  };

type Row = RouterOutputs['customer']['list']['items'][number];

/** The search box writes to the address a moment after the last key, not on every key. */
export function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Organizácie › Zákazníci or Partneri: one list, the role deciding what it shows. A partner has no
 * status, owner or products (docs/contacts-redesign.md).
 */
export function OrganizationList({
  role,
  params,
  setSearch,
}: {
  role: OrganizationRole;
  params: OrganizationSearch;
  setSearch: (next: Partial<OrganizationSearch>, keepPage?: boolean) => void;
}) {
  const customers = role === 'customer';
  const navigate = useNavigate();
  const toast = useToast();
  const [typed, setTyped] = useState(params.q ?? '');
  const debounced = useDebounced(typed.trim(), 300);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<'tag' | 'status' | null>(null);

  useEffect(() => {
    if ((params.q ?? '') !== debounced) setSearch({ q: debounced || undefined });
    // Only the typed text drives this; the address follows it.
  }, [debounced]);

  const filter = {
    role,
    search: params.q,
    ...(customers
      ? { status: params.status, productId: params.product, ownerUserId: params.owner }
      : {}),
    kind: params.kind,
    region: params.region,
    tagId: params.tag,
  };
  const activeFilter = Object.fromEntries(
    Object.entries(filter).filter(([, v]) => v !== undefined),
  ) as typeof filter;
  const list = useQuery({
    ...trpc.customer.list.queryOptions({
      ...activeFilter,
      sort: params.sort ?? 'name',
      dir: params.dir ?? 'asc',
      page: params.page ?? 1,
      pageSize: params.size ?? PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });
  const options = useQuery(trpc.customer.options.queryOptions());
  const canSend = useCan('email.send');
  const canRecord = useCan('activity.write');
  const [recording, setRecording] = useState(false);
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
        downloadText(datedFilename(customers ? 'zakaznici' : 'partneri', 'csv'), answer.csv);
        toast('success', t.exported);
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );

  const rows = list.data?.items ?? [];
  // An activity is about one record: offered when exactly one on this page is chosen.
  const single = selected.size === 1 ? rows.find((row) => selected.has(row.id)) : undefined;
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

  const filtered = Object.entries(filter).some(([key, v]) => key !== 'role' && v !== undefined);
  const counts = list.data?.counts;
  const productOptions = useMemo(
    () => [
      ...(options.data?.products ?? []).map((product) => ({
        value: product.id,
        label: product.name,
      })),
      { value: 'none', label: t.filters.noProduct },
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
            // The most recent contact first on the first click; names A to Z.
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

  const columns: {
    head: ReactNode;
    className?: string | undefined;
    sort?: 'ascending' | 'descending' | undefined;
  }[] = [
    {
      head: (
        <Checkbox
          key="all"
          aria-label={t.columns.selectAll}
          checked={allOnPage}
          onChange={toggleAll}
        />
      ),
      className: 'w-10',
    },
    {
      head: sortHeader('name', customers ? o.customerColumn : o.partnerColumn),
      sort: sortState('name'),
    },
    ...(customers ? [{ head: t.columns.products, className: 'hidden md:table-cell' }] : []),
    { head: t.columns.primaryContact, className: 'hidden lg:table-cell' },
    ...(customers ? [{ head: t.columns.owner, className: 'hidden xl:table-cell' }] : []),
    {
      head: customers ? t.columns.statusAndTags : t.columns.tags,
      className: customers ? 'hidden lg:table-cell' : 'hidden md:table-cell',
    },
    {
      head: sortHeader('lastContact', t.columns.lastContact),
      className: 'hidden xl:table-cell',
      sort: sortState('lastContact'),
    },
  ];

  return (
    <div className="min-w-0">
      <OrganizationsHeader active={customers ? 'customers' : 'partners'}>
        <Button
          variant="secondary"
          disabled={exportCsv.isPending || !list.data?.total}
          onClick={() => exportCsv.mutate(activeFilter)}
        >
          <Download className="size-4" aria-hidden />
          {t.exportAll}
        </Button>
        <Button asChild>
          <Link to="/organizations/new" search={{ role }}>
            <Plus className="size-4" aria-hidden />
            {customers ? o.newCustomer : o.newPartner}
          </Link>
        </Button>
      </OrganizationsHeader>

      <div className="max-w-[1400px] px-7 pt-5 pb-10">
        <TableShell
          header={
            <div>
              <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-4">
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
                  {customers ? (
                    <MultiFilterMenu
                      label={o.statusFilter}
                      values={params.status}
                      options={([...CUSTOMER_STATUSES, 'none'] as const).map((key) => ({
                        value: key,
                        label: key === 'none' ? t.chips.none : t.status[key],
                        count: counts?.[key],
                      }))}
                      onChange={(status) => setSearch({ status })}
                    />
                  ) : null}
                  <MultiFilterMenu
                    label={t.filters.kind}
                    values={params.kind}
                    options={CUSTOMER_KINDS.map((k) => ({ value: k, label: t.kind[k] }))}
                    onChange={(kind) => setSearch({ kind })}
                  />
                  {customers ? (
                    <MultiFilterMenu
                      label={t.filters.product}
                      values={params.product}
                      options={productOptions}
                      onChange={(product) => setSearch({ product })}
                    />
                  ) : null}
                  <MultiFilterMenu
                    label={t.filters.region}
                    values={params.region}
                    options={REGIONS.map((r) => ({ value: r, label: t.region[r] }))}
                    onChange={(region) => setSearch({ region })}
                  />
                  <MultiFilterMenu
                    label={t.filters.tag}
                    values={params.tag}
                    options={(options.data?.tags ?? []).map((tag) => ({
                      value: tag.id,
                      label: tag.name,
                    }))}
                    onChange={(tag) => setSearch({ tag })}
                  />
                  {customers ? (
                    <MultiFilterMenu
                      label={t.filters.owner}
                      values={params.owner}
                      options={(options.data?.users ?? []).map((u) => ({
                        value: u.id,
                        label: u.name,
                      }))}
                      onChange={(owner) => setSearch({ owner })}
                    />
                  ) : null}
                </div>
                <div className="ml-auto">
                  <SegmentsMenu
                    filter={Object.fromEntries(
                      Object.entries(activeFilter).filter(([key]) => key !== 'search'),
                    )}
                    onApply={(segment) =>
                      setSearch({
                        q: segment.search,
                        status: customers ? segment.status : undefined,
                        kind: segment.kind,
                        product: customers ? segment.productId : undefined,
                        region: segment.region,
                        tag: segment.tagId,
                        owner: customers ? segment.ownerUserId : undefined,
                      })
                    }
                  />
                </div>
              </div>
              {selected.size > 0 ? (
                <div className="mx-3 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-dark py-2 pr-2 pl-4 text-white">
                  <span className="mr-auto text-sm font-semibold">
                    {customers
                      ? o.customersSelected(selected.size)
                      : o.partnersSelected(selected.size)}
                  </span>
                  {canSend ? (
                    <BarButton onClick={() => compose.mutate({ customerIds: [...selected] })}>
                      {sk.campaigns.sendEmail}
                    </BarButton>
                  ) : null}
                  {canRecord && single ? (
                    <BarButton onClick={() => setRecording(true)}>{sk.activities.record}</BarButton>
                  ) : null}
                  <BarButton onClick={() => setDialog('tag')}>{t.bulk.addTag}</BarButton>
                  {customers ? (
                    <BarButton onClick={() => setDialog('status')}>{t.bulk.changeStatus}</BarButton>
                  ) : null}
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
          columns={columns.map((c) => c.head)}
          columnClassNames={columns.map((c) => c.className)}
          columnSort={columns.map((c) => c.sort)}
          loading={list.isPending}
          refreshing={list.isPlaceholderData}
          message={
            loadFailed(list) ? (
              <ErrorState onRetry={() => void list.refetch()} />
            ) : list.data && rows.length === 0 ? (
              <EmptyState
                compact
                title={
                  filtered
                    ? t.noResults.title
                    : customers
                      ? o.customersEmpty.title
                      : o.partnersEmpty.title
                }
                text={
                  filtered
                    ? t.noResults.text
                    : customers
                      ? o.customersEmpty.text
                      : o.partnersEmpty.text
                }
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
            <OrganizationRow
              key={row.id}
              row={row}
              customers={customers}
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
      {recording && single ? (
        <ActivityDialog
          customerId={single.id}
          customerName={single.name}
          onClose={() => setRecording(false)}
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

export function BarButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
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

function OrganizationRow({
  row,
  customers,
  checked,
  onToggle,
}: {
  row: Row;
  customers: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const href = `/organizations/${row.id}`;
  const meta = [
    row.city,
    row.kind === 'individual' ? o.privatePerson : null,
    row.foundEstablishment
      ? sk.establishments.found(row.foundEstablishment)
      : row.establishmentCount > 0
        ? sk.establishments.count(row.establishmentCount)
        : null,
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
            <p className="mt-0.5 truncate text-xs text-muted">{meta}</p>
          </div>
        </div>
      </TableCell>
      {customers ? (
        <TableCell className="hidden md:table-cell">
          <div className="flex flex-wrap gap-1">
            {row.products.map((product) => (
              <ProductChip key={product.id}>{product.name}</ProductChip>
            ))}
          </div>
        </TableCell>
      ) : null}
      <TableCell className="hidden lg:table-cell">
        {/* A private person is their own contact: nothing to repeat here. */}
        {row.kind === 'individual' ? null : row.primaryContact ? (
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
      {customers ? (
        <TableCell className="hidden text-muted xl:table-cell">
          {row.owner?.name ?? sk.common.none}
        </TableCell>
      ) : null}
      <TableCell className={customers ? 'hidden lg:table-cell' : 'hidden md:table-cell'}>
        {/* The status on its own line (none, nothing shown: D-6), the tags under it. */}
        {customers && row.status ? (
          <div className="mb-1">
            <CustomerStatusBadge status={row.status} />
          </div>
        ) : null}
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
