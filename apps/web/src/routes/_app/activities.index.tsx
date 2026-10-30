import { sk } from '@intra/shared/i18n';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useDebounced } from '@/components/customers/organization-list';
import { ErrorState } from '@/components/empty-state';
import { ActivitiesHeader } from '@/components/activities/activities-header';
import { TablePagination, TableShell } from '@/components/table-shell';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { CELL_LINK, RowLink, TableCell, TableRow } from '@/components/ui/table';
import { formatDate, formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/activities/')({ component: ActivitiesPage });

const t = sk.leadActivities;

const feedbackKindOf = (kind: string | null) =>
  kind ? ((t.feedbackKinds as Record<string, string>)[kind] ?? kind) : null;
const feedbackClientOf = (client: string | null) =>
  client ? ((t.feedbackClients as Record<string, string>)[client] ?? client) : null;

/** Aktivity: what customers and partners did on their own, the newest first (docs/activities.md). */
function ActivitiesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [productId, setProductId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const term = useDebounced(search.trim(), 250);
  const products = useQuery(trpc.product.list.queryOptions());
  const types = useQuery(trpc.activityType.list.queryOptions());
  const list = useQuery({
    ...trpc.leadActivity.list.queryOptions({
      page,
      ...(term ? { search: term } : {}),
      ...(type ? { typeId: type } : {}),
      ...(productId ? { productId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    placeholderData: keepPreviousData,
  });
  /** A changed filter starts from the first page again. */
  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const rows = list.data?.items ?? [];
  const c = t.columns;
  return (
    <div className="min-w-0">
      <ActivitiesHeader active="list" count={list.data?.total} />
      <main className="space-y-4 px-7 pt-5 pb-10">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              aria-label={t.search}
              placeholder={t.search}
              value={search}
              onChange={(event) => filter(setSearch)(event.target.value)}
              className="h-9 pl-9"
            />
          </div>
          <div className="w-52">
            <Select aria-label={t.filters.type} value={type} onChange={filter(setType)}>
              <SelectItem value="">{t.filters.allTypes}</SelectItem>
              {(types.data ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select
              aria-label={t.filters.product}
              value={productId}
              onChange={filter(setProductId)}
            >
              <SelectItem value="">{t.filters.allProducts}</SelectItem>
              {(products.data ?? []).map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="flex w-48 items-center gap-2">
            <span aria-hidden className="text-[13px] text-muted">
              {t.filters.fromShort}
            </span>
            <DatePicker
              label={t.filters.from}
              value={from}
              onChange={filter(setFrom)}
              max={to || undefined}
            />
          </div>
          <div className="flex w-48 items-center gap-2">
            <span aria-hidden className="text-[13px] text-muted">
              {t.filters.toShort}
            </span>
            <DatePicker
              label={t.filters.to}
              value={to}
              onChange={filter(setTo)}
              min={from || undefined}
            />
          </div>
        </div>
        {loadFailed(list) ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : (
          <TableShell
            columns={[c.at, c.type, c.product, c.organization, c.contact, c.source]}
            loading={list.isPending}
            refreshing={list.isPlaceholderData}
            message={list.data && rows.length === 0 ? t.empty : null}
            footer={
              <TablePagination page={page} total={list.data?.total ?? 0} onPageChange={setPage} />
            }
          >
            {rows.map((row) => {
              const href = `/activities/${row.id}`;
              return (
                <TableRow key={row.id} href={href}>
                  <TableCell className="whitespace-nowrap">
                    <RowLink href={href} className="font-semibold">
                      {formatDateTime(row.createdAt)}
                    </RowLink>
                    {row.confirmedCount > 1 ? (
                      <span
                        title={t.detail.confirmedCount}
                        className="ml-1.5 rounded-full bg-track px-1.5 text-[11px] font-bold text-muted"
                      >
                        {row.confirmedCount}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge tone="info" dot>
                      {row.typeName}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {row.productName ? (
                      <span className="inline-flex rounded-md bg-info-soft px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-info">
                        {row.productName}
                      </span>
                    ) : (
                      sk.common.none
                    )}
                  </TableCell>
                  <TableCell>
                    {row.organizationId ? (
                      <>
                        <RowLink
                          href={`/organizations/${row.parentId ?? row.organizationId}`}
                          className={CELL_LINK}
                        >
                          {row.parentName ?? row.organizationName}
                        </RowLink>
                        {row.parentName ? (
                          <p className="mt-1 text-xs text-muted">
                            {t.workplace(row.organizationName ?? '')}
                          </p>
                        ) : null}
                        {row.organizationRole ? (
                          <p className="mt-1 text-xs text-muted">{t.roles[row.organizationRole]}</p>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-warning">{t.unassigned}</span>
                        {row.sourceOrganizationName ? (
                          <p className="mt-1 text-xs text-muted">
                            {t.inApp(row.sourceOrganizationName)}
                          </p>
                        ) : null}
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.contactId ? (
                      <RowLink href={`/contacts/${row.contactId}`} className={CELL_LINK}>
                        {row.contactName}
                      </RowLink>
                    ) : (
                      <span className="text-[13px] text-muted">
                        {row.reporterName ?? t.noContact}
                      </span>
                    )}
                    {row.email ? (
                      <p className={cn('text-xs text-muted', row.contactId && 'mt-1')}>
                        {row.email}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.source === 'app' ? (
                      <>
                        <p className="text-[13px]">{t.fromApp(row.productName ?? '')}</p>
                        <p className="text-xs text-muted">
                          {[feedbackKindOf(row.feedbackKind), feedbackClientOf(row.feedbackClient)]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[13px]">{row.subject ?? sk.common.none}</p>
                        {row.sentAt ? (
                          <p className="text-xs text-muted">{t.sentOn(formatDate(row.sentAt))}</p>
                        ) : null}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableShell>
        )}
      </main>
    </div>
  );
}
