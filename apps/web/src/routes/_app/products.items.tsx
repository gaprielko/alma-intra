import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { ItemDialog } from '@/components/products/item-dialog';
import { ProductsHeader } from '@/components/products/products-header';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  CELL_LINK,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/products/items')({ component: ItemsPage });

const t = sk.products.items;
type Item = RouterOutputs['product']['items'][number];

/** Položky: the shared catalog of item names (R-2), with the products that use each. */
function ItemsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const items = useQuery(trpc.product.items.queryOptions());
  const canWrite = useCan('product.write');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const remove = useMutation(
    trpc.product.itemDelete.mutationOptions({
      onSuccess: async () => {
        toast('success', t.deleted);
        await queryClient.invalidateQueries(trpc.product.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.products.errors)),
    }),
  );
  const term = search.trim().toLocaleLowerCase('sk');
  const rows = (items.data ?? []).filter(
    (item) => !term || item.name.toLocaleLowerCase('sk').includes(term),
  );
  return (
    <div className="min-w-0">
      <ProductsHeader active="items">
        {canWrite ? (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            {t.new}
          </Button>
        ) : null}
      </ProductsHeader>
      <main className="max-w-[1400px] px-7 pt-5 pb-10">
        {items.isPending ? (
          <CardSkeleton lines={4} />
        ) : loadFailed(items) ? (
          <ErrorState onRetry={() => void items.refetch()} />
        ) : (
          <Card>
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
              <div className="relative min-w-60 flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <Input
                  aria-label={t.search}
                  placeholder={t.search}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-9 pl-9"
                />
              </div>
              <span className="ml-auto text-xs text-muted">{t.hint}</span>
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{t.empty}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <tr>
                      <TableHead>{t.columns.name}</TableHead>
                      <TableHead>{t.columns.unit}</TableHead>
                      <TableHead>{t.columns.usedIn}</TableHead>
                      <TableHead>{t.columns.description}</TableHead>
                      <TableHead className="w-12" />
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {rows.map((item) => (
                      <TableRow
                        key={item.id}
                        onClick={canWrite ? () => setEditing(item) : undefined}
                      >
                        <TableCell className="font-semibold">{item.name}</TableCell>
                        <TableCell className="text-muted">{item.unit ?? sk.common.none}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.usedIn.map((use) => (
                              <Link
                                key={use.productId}
                                to="/products/$productId"
                                params={{ productId: use.productId }}
                                className={CELL_LINK}
                              >
                                {use.product}
                              </Link>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted">{item.description}</TableCell>
                        <TableCell>
                          {canWrite ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" aria-label={sk.products.menu(item.name)}>
                                  <MoreHorizontal className="size-4" aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setEditing(item)}>
                                  {t.edit}
                                </DropdownMenuItem>
                                {item.usedIn.length === 0 ? (
                                  <DropdownMenuItem
                                    destructive
                                    onSelect={() => remove.mutate({ id: item.id })}
                                  >
                                    {t.delete}
                                  </DropdownMenuItem>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="h-3" />
          </Card>
        )}
      </main>
      {editing ? (
        <ItemDialog
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
