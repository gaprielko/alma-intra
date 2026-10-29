import { sk } from '@intra/shared/i18n';
import { toCents } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { EstablishmentChip } from '@/components/customers/establishments-card';
import { type Holding, HoldingDialog } from '@/components/customers/holding-dialog';
import { formatEur } from '@/components/products/products-header';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SegmentedChoice } from '@/components/ui/segmented';
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
import { formatDate } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.holdings;
type Vat = 'gross' | 'net';

/** „2 × Admin prístup · 6 × Sestra“: the recurring items a holding has. */
const scopeOf = (h: Holding) =>
  h.items
    .filter((i) => i.billing === 'recurring' && i.count > 0)
    .map((i) => `${i.count} × ${i.name}`)
    .join(' · ');

const modeOf = (h: Holding) =>
  h.pricing === 'discount' ? t.modes.discount(h.discountPercent ?? 0) : t.modes[h.pricing];

/**
 * „Produkty“ of an organization (docs/products.md 9.1): its own rows, then „Produkty prevádzok“,
 * and the total of what is held now; a prevádzka shows its own. With or without VAT.
 */
export function HoldingsCard({
  customerId,
  customerName,
  isEstablishment,
}: {
  customerId: string;
  customerName: string;
  isEstablishment: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const held = useQuery(trpc.customer.holdings.queryOptions({ id: customerId }));
  const establishments = useQuery({
    ...trpc.customer.establishments.queryOptions({ id: customerId }),
    enabled: !isEstablishment,
  });
  const [vat, setVat] = useState<Vat>('gross');
  const [editing, setEditing] = useState<Holding | 'new' | null>(null);
  const [ending, setEnding] = useState<Holding | null>(null);
  const end = useMutation(
    trpc.customer.holdingEnd.mutationOptions({
      onSuccess: async () => {
        toast('success', t.endDone);
        setEnding(null);
        await Promise.all([
          queryClient.invalidateQueries(trpc.customer.pathFilter()),
          queryClient.invalidateQueries(trpc.product.pathFilter()),
        ]);
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );

  const rows = held.data ?? [];
  const own = rows.filter((h) => !h.holder.isEstablishment || isEstablishment);
  const ofEstablishments = isEstablishment ? [] : rows.filter((h) => h.holder.isEstablishment);
  const monthly = (h: Holding) => (vat === 'gross' ? h.price.monthlyGross : h.price.monthly);
  const yearly = (h: Holding) => (vat === 'gross' ? h.price.yearlyGross : h.price.yearly);
  const live = rows.filter((h) => h.active);
  const holders = [
    { id: customerId, name: customerName, isEstablishment },
    ...(establishments.data ?? []).map((e) => ({ id: e.id, name: e.name, isEstablishment: true })),
  ];

  const row = (h: Holding) => (
    <TableRow key={`${h.organizationId}-${h.productId}`} className={cn(!h.active && 'opacity-60')}>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          <Link
            to="/products/$productId"
            params={{ productId: h.productId }}
            className="font-semibold hover:underline"
          >
            {h.product.name}
          </Link>
          {h.holder.isEstablishment && !isEstablishment ? (
            <EstablishmentChip name={h.holder.name} />
          ) : null}
        </span>
        <span className="block text-xs text-muted">
          {[
            t.since(formatDate(h.validFrom)),
            h.validTo ? t.until(formatDate(h.validTo)) : null,
            h.active ? modeOf(h) : t.ended,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </TableCell>
      <TableCell className="text-sm text-muted">{scopeOf(h) || sk.common.none}</TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {formatEur(monthly(h))}
      </TableCell>
      <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
        {formatEur(yearly(h))}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" aria-label={t.menu(h.product.name)}>
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(h)}>{t.edit}</DropdownMenuItem>
            {h.active ? (
              <DropdownMenuItem destructive onSelect={() => setEnding(h)}>
                {t.end}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );

  return (
    <Card>
      <CardHeader
        title={
          <>
            {t.title}
            {rows.length > 0 ? (
              <span className="ml-1.5 font-normal text-muted">· {rows.length}</span>
            ) : null}
          </>
        }
        action={
          <span className="flex items-center gap-2">
            {rows.length > 0 ? (
              <SegmentedChoice
                label={`${sk.products.gross} / ${sk.products.net}`}
                value={vat}
                onChange={setVat}
                options={[
                  { key: 'gross', label: sk.products.gross },
                  { key: 'net', label: sk.products.net },
                ]}
              />
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
              <Plus className="size-3.5" aria-hidden />
              {t.assign}
            </Button>
          </span>
        }
      />
      {rows.length === 0 ? (
        <p className="px-5 pt-2 pb-5 text-sm text-muted">{t.empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.columns.product}</TableHead>
                <TableHead>{t.columns.scope}</TableHead>
                <TableHead className="text-right">{t.columns.monthly}</TableHead>
                <TableHead className="text-right">{t.columns.yearly}</TableHead>
                <TableHead className="w-12" />
              </tr>
            </TableHeader>
            <TableBody>
              {own.map(row)}
              {ofEstablishments.length > 0 ? (
                <>
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="bg-surface py-1.5 text-xs font-semibold text-muted"
                    >
                      {t.establishmentsGroup}
                    </TableCell>
                  </TableRow>
                  {ofEstablishments.map(row)}
                </>
              ) : null}
              <TableRow>
                <TableCell colSpan={2} className="font-semibold">
                  {ofEstablishments.length > 0 ? t.total : t.totalOwn}
                </TableCell>
                <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                  {formatEur(toCents(live.reduce((sum, h) => sum + monthly(h), 0)))}
                </TableCell>
                <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                  {formatEur(toCents(live.reduce((sum, h) => sum + yearly(h), 0)))}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
      <div className="h-2" />
      {editing ? (
        <HoldingDialog
          organizationId={customerId}
          organizationName={customerName}
          holders={holders}
          holding={editing === 'new' ? undefined : editing}
          taken={new Set(rows.map((h) => `${h.organizationId}:${h.productId}`))}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {ending ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setEnding(null)}
          title={`${t.end}: ${ending.product.name}`}
          description={t.since(formatDate(ending.validFrom))}
          confirmLabel={t.end}
          destructive
          pending={end.isPending}
          onConfirm={() =>
            end.mutate({ organizationId: ending.organizationId, productId: ending.productId })
          }
        />
      ) : null}
    </Card>
  );
}
