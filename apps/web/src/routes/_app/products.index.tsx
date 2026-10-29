import { sk } from '@intra/shared/i18n';
import { withVat } from '@intra/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { formatEur, ProductsHeader } from '@/components/products/products-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SegmentedChoice } from '@/components/ui/segmented';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/products/')({ component: ProductsPage });

const p = sk.products;

/** Produkty: every product with its base price, what it includes and its surcharges (R-5). */
function ProductsPage() {
  const list = useQuery(trpc.product.list.queryOptions());
  const vat = useQuery(trpc.product.vatRate.queryOptions());
  const canWrite = useCan('product.write');
  const [gross, setGross] = useState<'gross' | 'net'>('gross');
  const [search, setSearch] = useState('');
  const rate = vat.data?.vatRate ?? 23;
  const show = (net: number | null, withTax: number | null) =>
    gross === 'gross' ? (withTax ?? (net === null ? null : withVat(net, rate))) : net;
  const term = search.trim().toLocaleLowerCase('sk');
  const rows = (list.data ?? []).filter(
    (row) => !term || `${row.name} ${row.description ?? ''}`.toLocaleLowerCase('sk').includes(term),
  );

  return (
    <div className="min-w-0">
      <ProductsHeader active="products">
        {canWrite ? (
          <Button asChild>
            <Link to="/products/$productId" params={{ productId: 'new' }}>
              <Plus className="size-4" aria-hidden />
              {p.new}
            </Link>
          </Button>
        ) : null}
      </ProductsHeader>
      <main className="max-w-[1400px] px-7 pt-5 pb-10">
        {list.isPending ? (
          <CardSkeleton lines={4} />
        ) : loadFailed(list) ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : (
          <Card>
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
              <div className="relative min-w-60 flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <Input
                  aria-label={p.search}
                  placeholder={p.search}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-9 pl-9"
                />
              </div>
              <SegmentedChoice
                className="ml-auto"
                label={p.columns.baseGross}
                value={gross}
                onChange={setGross}
                options={[
                  { key: 'gross', label: p.gross },
                  { key: 'net', label: p.net },
                ]}
              />
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{p.empty}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <tr>
                      <TableHead className="w-[26%]">{p.columns.product}</TableHead>
                      <TableHead>
                        {gross === 'gross' ? p.columns.baseGross : p.columns.baseNet}
                      </TableHead>
                      <TableHead>{p.columns.included}</TableHead>
                      <TableHead>
                        {gross === 'gross' ? p.columns.extrasGross : p.columns.extrasNet}
                      </TableHead>
                      <TableHead className="text-right">{p.columns.customers}</TableHead>
                      <TableHead>{p.columns.state}</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const base = show(row.basePrice, row.basePriceGross);
                      const other =
                        gross === 'gross' ? row.basePrice : (row.basePriceGross ?? null);
                      return (
                        <TableRow key={row.id} href={`/products/${row.id}`}>
                          <TableCell>
                            <Link
                              to="/products/$productId"
                              params={{ productId: row.id }}
                              className="inline-flex rounded-md bg-info-soft px-2 py-0.5 text-[13px] font-semibold text-info hover:underline"
                            >
                              {row.name}
                            </Link>
                            {row.description ? (
                              <span className="mt-1 block text-xs text-muted">
                                {row.description}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {base === null ? (
                              <span className="text-[13px] text-muted">{p.noPrice}</span>
                            ) : (
                              <>
                                <strong className="text-[15px]">{formatEur(base)}</strong>{' '}
                                <span className="text-xs text-muted">
                                  {p.perPeriod[row.period]}
                                </span>
                                {other === null ? null : (
                                  <span className="block text-xs text-muted">
                                    {gross === 'gross' ? p.net : p.gross} {formatEur(other)}
                                  </span>
                                )}
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-[13px] whitespace-nowrap">
                            {row.items.filter((i) => i.included > 0).length === 0
                              ? sk.common.none
                              : row.items
                                  .filter((i) => i.included > 0)
                                  .map((i) => (
                                    <span key={i.itemId} className="block">
                                      {i.included} × {i.name}
                                    </span>
                                  ))}
                          </TableCell>
                          <TableCell className="text-[13px] whitespace-nowrap text-muted">
                            {row.items.filter((i) => i.unitPrice !== null).length === 0
                              ? sk.common.none
                              : row.items
                                  .filter((i) => i.unitPrice !== null)
                                  .map((i) => {
                                    const price = show(i.unitPrice, i.unitPriceGross)!;
                                    return (
                                      <span key={i.itemId} className="block">
                                        {i.name} {i.included > 0 ? '+' : ''}
                                        {formatEur(price)}
                                      </span>
                                    );
                                  })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.customers}</TableCell>
                          <TableCell>
                            <Badge tone={row.active ? 'success' : 'neutral'}>
                              {row.active ? p.offered : p.withdrawn}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="border-t border-border-subtle px-5 py-3 text-[13px] text-muted">
              {p.count(rows.length)}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
