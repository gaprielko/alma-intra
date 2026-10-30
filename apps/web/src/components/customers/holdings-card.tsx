import { sk } from '@intra/shared/i18n';
import { toCents } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CELL_LINK,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.holdings;

/** „2 × Admin prístup“, „6 × Sestra“: the recurring items a holding has, one per line. */
const scopeOf = (h: Holding) =>
  h.items
    .filter((i) => i.billing === 'recurring' && i.count > 0)
    .map((i) => `${i.count} × ${i.name}`);

const modeOf = (h: Holding) =>
  h.pricing === 'discount' ? t.modes.discount(h.discountPercent ?? 0) : t.modes[h.pricing];

/**
 * „Produkty“ of an organization (docs/products.md 9.1): its own rows, then „Produkty prevádzok“,
 * and the total of what is held now; a prevádzka shows its own. Prices with or without VAT as the
 * organization has it set (`withVat`). `embedded` is the list in the organization's form: its own
 * rows only, in a frame instead of a card.
 */
export function HoldingsCard({
  customerId,
  customerName,
  isEstablishment,
  withVat,
  embedded = false,
}: {
  customerId: string;
  customerName: string;
  isEstablishment: boolean;
  withVat: boolean;
  embedded?: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const held = useQuery(trpc.customer.holdings.queryOptions({ id: customerId }));
  const establishments = useQuery({
    ...trpc.customer.establishments.queryOptions({ id: customerId }),
    enabled: !isEstablishment && !embedded,
  });
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

  const all = held.data ?? [];
  const rows = embedded ? all.filter((h) => !h.holder.isEstablishment || isEstablishment) : all;
  const own = rows.filter((h) => !h.holder.isEstablishment || isEstablishment);
  const ofEstablishments = isEstablishment ? [] : rows.filter((h) => h.holder.isEstablishment);
  const monthly = (h: Holding) => (withVat ? h.price.monthlyGross : h.price.monthly);
  const yearly = (h: Holding) => (withVat ? h.price.yearlyGross : h.price.yearly);
  const live = rows.filter((h) => h.active);
  const holders = [
    { id: customerId, name: customerName, isEstablishment },
    ...(embedded ? [] : (establishments.data ?? [])).map((e) => ({
      id: e.id,
      name: e.name,
      isEstablishment: true,
    })),
  ];

  const row = (h: Holding) => {
    const scope = scopeOf(h);
    return (
      <TableRow
        key={`${h.organizationId}-${h.productId}`}
        // The row edits the holding, as the first item of its menu; the product opens from its button.
        onClick={() => setEditing(h)}
        className={cn('align-top', !h.active && 'opacity-60')}
      >
        <TableCell>
          <span className="flex flex-wrap items-center gap-1.5">
            <Link
              to="/products/$productId"
              params={{ productId: h.productId }}
              className={CELL_LINK}
            >
              {h.product.name}
            </Link>
            {h.holder.isEstablishment && !isEstablishment ? (
              <EstablishmentChip name={h.holder.name} />
            ) : null}
          </span>
          <span className="block text-xs text-muted">{h.active ? modeOf(h) : t.ended}</span>
        </TableCell>
        <TableCell className="text-[13px]">
          {scope.length > 0
            ? scope.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))
            : sk.common.none}
        </TableCell>
        <TableCell className="text-[13px] whitespace-nowrap">
          {t.since(formatDate(h.validFrom))}
          {h.validTo ? (
            <span className="block text-xs text-muted">{t.until(formatDate(h.validTo))}</span>
          ) : null}
        </TableCell>
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
  };

  const title = (
    <>
      {t.title}
      {rows.length > 0 ? (
        <span className="ml-1.5 font-normal text-muted">· {rows.length}</span>
      ) : null}
    </>
  );
  const assign = (
    <Button type="button" variant="secondary" size="sm" onClick={() => setEditing('new')}>
      <Plus className="size-3.5" aria-hidden />
      {t.assign}
    </Button>
  );
  const body =
    rows.length === 0 ? (
      <p className={cn('text-sm text-muted', embedded ? 'px-3.5 py-4' : 'px-5 pt-2 pb-5')}>
        {t.empty}
      </p>
    ) : (
      <div className={cn('overflow-x-auto', !embedded && 'mt-3')}>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>{t.columns.product}</TableHead>
              <TableHead>{t.columns.scope}</TableHead>
              <TableHead>{t.columns.validity}</TableHead>
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
                    colSpan={6}
                    className="bg-surface py-1.5 text-xs font-semibold text-muted"
                  >
                    {t.establishmentsGroup}
                  </TableCell>
                </TableRow>
                {ofEstablishments.map(row)}
              </>
            ) : null}
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
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
    );
  const dialogs: ReactNode = (
    <>
      {editing ? (
        <HoldingDialog
          organizationId={customerId}
          organizationName={customerName}
          holders={holders}
          holding={editing === 'new' ? undefined : editing}
          taken={new Set(all.map((h) => `${h.organizationId}:${h.productId}`))}
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
    </>
  );

  if (embedded) {
    return (
      <div className="rounded-xl border border-border-subtle">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b border-border-subtle bg-surface px-3.5 py-2.5">
          <span className="text-sm font-semibold">{title}</span>
          {assign}
        </div>
        {body}
        <p className="border-t border-border-subtle px-3.5 py-2.5 text-xs text-muted">
          {withVat ? t.pricesGross : t.pricesNet}
          {isEstablishment ? null : ` ${t.establishmentsElsewhere}`}
        </p>
        {dialogs}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader
        title={title}
        action={
          <span className="flex items-center gap-2">
            <span
              className="inline-flex h-7 items-center rounded-lg border border-border-subtle bg-surface px-2.5 text-[13px] font-semibold text-muted"
              title={t.pricesSetting}
            >
              {withVat ? t.pricesGrossLabel : t.pricesNetLabel}
            </span>
            {assign}
          </span>
        }
      />
      {body}
      <div className="h-2" />
      {dialogs}
    </Card>
  );
}
