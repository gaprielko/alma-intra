import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Plus, Store } from 'lucide-react';
import { useState } from 'react';
import { ProductChip } from '@/components/customers/customer-bits';
import { EstablishmentDialog } from '@/components/customers/establishment-dialog';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatRecent } from '@/lib/format';
import { type RouterOutputs, trpc } from '@/lib/trpc';

const e = sk.establishments;
type Establishment = RouterOutputs['customer']['establishments'][number];

/** The orange mark of a prevádzka, used wherever one is named. */
export function EstablishmentChip({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={
        'inline-flex max-w-full items-center gap-1 rounded-md bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning ' +
        (className ?? '')
      }
    >
      <Store className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * The prevádzky of an organization (docs/establishments.md 4.1): shown only when there is one,
 * a table with each one's primary person, persons, products and last contact.
 */
export function EstablishmentsCard({
  parentId,
  parentName,
}: {
  parentId: string;
  parentName: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const list = useQuery(trpc.customer.establishments.queryOptions({ id: parentId }));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Establishment | null>(null);
  const remove = useMutation(
    trpc.customer.delete.mutationOptions({
      onSuccess: async () => {
        toast('success', e.deleteConfirm.done);
        setRemoving(null);
        await queryClient.invalidateQueries(trpc.customer.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.customers.errors)),
    }),
  );
  const rows = list.data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title={
          <>
            {e.title}
            <span className="ml-1.5 font-normal text-muted">· {rows.length}</span>
          </>
        }
        action={
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden />
            {e.add}
          </Button>
        }
      />
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <tr>
              <TableHead>{e.columns.name}</TableHead>
              <TableHead>{e.columns.primary}</TableHead>
              <TableHead className="text-right">{e.columns.persons}</TableHead>
              <TableHead>{e.columns.products}</TableHead>
              <TableHead>{e.columns.last}</TableHead>
              <TableHead className="w-12" />
            </tr>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    to="/organizations/$customerId"
                    params={{ customerId: row.id }}
                    className="inline-flex items-center gap-1.5 font-semibold hover:underline"
                  >
                    <Store className="size-4 shrink-0 text-warning" aria-hidden />
                    {row.name}
                  </Link>
                  <span className="block text-xs text-muted">
                    {[row.street, [row.postalCode, row.city].filter(Boolean).join(' ')]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </TableCell>
                <TableCell>
                  {row.primaryContact ? (
                    <>
                      <Link
                        to="/contacts/$personId"
                        params={{ personId: row.primaryContact.id }}
                        className="hover:underline"
                      >
                        {row.primaryContact.name}
                      </Link>
                      {row.primaryContact.email ? (
                        <span className="block text-xs text-muted">{row.primaryContact.email}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-sm text-muted">{e.noPrimary}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{row.persons}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.products.map((product) => (
                      <ProductChip key={product.id}>{product.name}</ProductChip>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted">
                  {row.lastContactAt ? formatRecent(row.lastContactAt) : sk.common.none}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" aria-label={e.menu(row.name)}>
                        <MoreHorizontal className="size-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to="/organizations/$customerId" params={{ customerId: row.id }}>
                          {e.edit}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem destructive onSelect={() => setRemoving(row)}>
                        {e.delete}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="h-2" />
      {adding ? (
        <EstablishmentDialog
          parentId={parentId}
          parentName={parentName}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={e.deleteConfirm.title(removing.name)}
          description={e.deleteConfirm.text}
          confirmLabel={e.deleteConfirm.confirm}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ id: removing.id })}
        />
      ) : null}
    </Card>
  );
}
