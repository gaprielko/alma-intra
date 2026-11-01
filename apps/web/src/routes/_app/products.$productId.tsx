import { sk } from '@intra/shared/i18n';
import {
  HOLDERS_PAGE_SIZE,
  type ItemBilling,
  priceOf,
  type ProductApp,
  type ProductItemKind,
  type ProductPeriod,
  withoutVat,
  withVat,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { AppChips } from '@/components/products/app-chips';
import { ItemDialog } from '@/components/products/item-dialog';
import { PageHeader } from '@/components/page-header';
import { formatEur, moneyText, parseMoney } from '@/components/products/products-header';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TablePagination } from '@/components/table-shell';
import { RowActions } from '@/components/ui/table';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedChoice } from '@/components/ui/segmented';
import { Select, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/products/$productId')({ component: ProductPage });

const d = sk.products.detail;
type Product = RouterOutputs['product']['get'];
type CatalogItem = RouterOutputs['product']['items'][number];

/** A row of the price list being edited; prices as typed. */
interface Row {
  itemId: string;
  kind: ProductItemKind;
  apps: ProductApp[];
  name: string;
  unit: string | null;
  billing: ItemBilling;
  included: string;
  unitPrice: string;
  unitPriceGross: string;
  max: string;
  byWorkload: boolean;
}

interface Draft {
  name: string;
  description: string;
  active: boolean;
  basePrice: string;
  basePriceGross: string;
  period: ProductPeriod;
  workloadStep: string;
  rows: Row[];
}

const emptyDraft: Draft = {
  name: '',
  description: '',
  active: true,
  basePrice: '',
  basePriceGross: '',
  period: 'month',
  workloadStep: '50',
  rows: [],
};

const draftOf = (product: Product): Draft => ({
  name: product.name,
  description: product.description ?? '',
  active: product.active,
  basePrice: moneyText(product.basePrice),
  basePriceGross: moneyText(product.basePriceGross),
  period: product.period,
  workloadStep: String(product.workloadStep),
  rows: product.items.map((item) => ({
    itemId: item.itemId,
    kind: item.kind,
    apps: item.apps,
    name: item.name,
    unit: item.unit,
    billing: item.billing,
    included: String(item.included),
    unitPrice: moneyText(item.unitPrice),
    unitPriceGross: moneyText(item.unitPriceGross),
    max: item.max === null ? '' : String(item.max),
    byWorkload: item.byWorkload,
  })),
});

/**
 * A row's name, unit and applications belong to the item, not to the draft: a change in the catalog
 * shows here even when the draft was made from a cached product before the refetch brought it.
 */
const withCurrentItems = (draft: Draft, product: Product | undefined): Draft => ({
  ...draft,
  rows: draft.rows.map((row) => {
    const item = product?.items.find((candidate) => candidate.itemId === row.itemId);
    return item ? { ...row, name: item.name, unit: item.unit, apps: item.apps } : row;
  }),
});

/** The roles first, then the other items (R-22); each keeps its order. */
const rolesFirst = (rows: Row[]) => [
  ...rows.filter((row) => row.kind === 'role'),
  ...rows.filter((row) => row.kind === 'other'),
];

const intOf = (text: string, fallback: number) => {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** A product's detail at /products/<id>, edited in place; /products/new makes one (docs/products.md 6). */
function ProductPage() {
  const { productId } = Route.useParams();
  const isNew = productId === 'new';
  const product = useQuery({
    ...trpc.product.get.queryOptions({ id: productId }),
    enabled: !isNew,
  });
  const vat = useQuery(trpc.product.vatRate.queryOptions());
  if (!isNew && product.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader title={sk.common.loading} back={{ to: '/products', label: d.back }} />
        <div className="p-7">
          <CardSkeleton lines={5} />
        </div>
      </div>
    );
  }
  if (!isNew && loadFailed(product)) {
    return (
      <div className="min-w-0">
        <PageHeader title={sk.products.title} back={{ to: '/products', label: d.back }} />
        <div className="p-10">
          <ErrorState
            text={errorMessage(product.error, sk.products.errors)}
            onRetry={() => void product.refetch()}
          />
        </div>
      </div>
    );
  }
  return (
    <ProductEditor
      key={product.data?.updatedAt ? String(product.data.updatedAt) : 'new'}
      product={isNew ? undefined : product.data}
      rate={vat.data?.vatRate ?? 23}
    />
  );
}

function ProductEditor({ product, rate }: { product: Product | undefined; rate: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canWrite = useCan('product.write');
  const [edited, setDraft] = useState<Draft>(() => (product ? draftOf(product) : emptyDraft));
  const draft = withCurrentItems(edited, product);
  const [adding, setAdding] = useState<ProductItemKind | null>(null);
  const [deleting, setDeleting] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setRow = (index: number, patch: Partial<Row>) =>
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  const move = (index: number, by: number) =>
    setDraft((current) => {
      const rows = [...current.rows];
      const [row] = rows.splice(index, 1);
      rows.splice(index + by, 0, row!);
      return { ...current, rows };
    });

  const removeRow = (index: number) =>
    setDraft((current) => ({ ...current, rows: current.rows.filter((_, i) => i !== index) }));

  /** Typing one price fills the other (R-9). */
  const pair = (text: string, gross: boolean) => {
    const n = parseMoney(text);
    const other = n === null ? '' : moneyText(gross ? withoutVat(n, rate) : withVat(n, rate));
    return gross ? { gross: text, net: other } : { net: text, gross: other };
  };

  const input = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    active: draft.active,
    basePrice: parseMoney(draft.basePrice),
    basePriceGross: parseMoney(draft.basePriceGross),
    period: draft.period,
    workloadStep: Math.min(100, Math.max(1, intOf(draft.workloadStep, 50))),
    items: draft.rows.map((row) => ({
      itemId: row.itemId,
      included: intOf(row.included, 0),
      unitPrice: parseMoney(row.unitPrice),
      unitPriceGross: parseMoney(row.unitPriceGross),
      max: row.max.trim() ? intOf(row.max, 0) : null,
      billing: row.billing,
      byWorkload: row.billing === 'recurring' && row.byWorkload,
    })),
  };

  const done = async (message: string) => {
    toast('success', message);
    await queryClient.invalidateQueries(trpc.product.pathFilter());
  };
  const onError = (error: unknown) => toast('error', errorMessage(error, sk.products.errors));
  const create = useMutation(
    trpc.product.create.mutationOptions({
      onSuccess: async (created) => {
        await done(d.created);
        await navigate({ to: '/products/$productId', params: { productId: created.id } });
      },
      onError,
    }),
  );
  const update = useMutation(
    trpc.product.update.mutationOptions({ onSuccess: () => done(d.saved), onError }),
  );
  const duplicate = useMutation(
    trpc.product.duplicate.mutationOptions({
      onSuccess: async (created) => {
        await done(d.duplicated);
        await navigate({ to: '/products/$productId', params: { productId: created.id } });
      },
      onError,
    }),
  );
  const remove = useMutation(
    trpc.product.delete.mutationOptions({
      onSuccess: async () => {
        await done(d.deleteConfirm.done);
        await navigate({ to: '/products' });
      },
      onError,
    }),
  );
  const pending = create.isPending || update.isPending;
  const save = () =>
    product ? update.mutate({ id: product.id, product: input }) : create.mutate(input);

  return (
    <div className="min-w-0">
      <PageHeader
        title={product ? product.name : d.newTitle}
        back={{ to: '/products', label: d.back }}
        subtitle={
          product ? (
            <span className="flex flex-wrap gap-x-3.5">
              <span>
                {d.customers} <span className="text-foreground">{product.customers}</span>
              </span>
              <span>
                {d.updated} <span className="text-foreground">{formatDate(product.updatedAt)}</span>
              </span>
            </span>
          ) : undefined
        }
      >
        {product && canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" aria-label={sk.products.menu(product.name)}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                {d.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {product && canWrite ? (
          <Button
            variant="secondary"
            disabled={duplicate.isPending}
            onClick={() => duplicate.mutate({ id: product.id })}
          >
            {d.duplicate}
          </Button>
        ) : null}
        {canWrite ? (
          <Button disabled={pending || !input.name} onClick={save}>
            {pending ? sk.common.saving : product ? d.save : d.create}
          </Button>
        ) : null}
      </PageHeader>

      <main className="grid items-start gap-5 px-7 pt-5 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title={d.basics} />
            <div className="grid gap-3 px-5 pt-3.5 pb-5 sm:grid-cols-6">
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="product-name">{d.name}</Label>
                <Input
                  id="product-name"
                  value={draft.name}
                  onChange={(event) => set('name', event.target.value)}
                />
              </div>
              <div className="space-y-0.5 sm:col-span-3">
                <span className="block text-xs leading-4 font-medium text-muted">{d.state}</span>
                <SegmentedChoice
                  label={d.state}
                  value={draft.active ? 'on' : 'off'}
                  onChange={(next) => set('active', next === 'on')}
                  options={[
                    { key: 'on', label: sk.products.offered },
                    { key: 'off', label: sk.products.withdrawn },
                  ]}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-6">
                <Label htmlFor="product-description">{d.description}</Label>
                <Textarea
                  id="product-description"
                  rows={2}
                  maxLength={400}
                  value={draft.description}
                  onChange={(event) => set('description', event.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="product-base">{d.baseNet}</Label>
                <Input
                  id="product-base"
                  inputMode="decimal"
                  // Worked out from the price with VAT, which is the one entered.
                  className="bg-surface"
                  value={draft.basePrice}
                  onChange={(event) => {
                    const both = pair(event.target.value, false);
                    setDraft((c) => ({ ...c, basePrice: both.net, basePriceGross: both.gross }));
                  }}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="product-base-gross">{d.baseGross(rate)}</Label>
                <Input
                  id="product-base-gross"
                  inputMode="decimal"
                  value={draft.basePriceGross}
                  onChange={(event) => {
                    const both = pair(event.target.value, true);
                    setDraft((c) => ({ ...c, basePrice: both.net, basePriceGross: both.gross }));
                  }}
                />
              </div>
              <div className="space-y-0.5 sm:col-span-2">
                <span className="block text-xs leading-4 font-medium text-muted">{d.period}</span>
                <SegmentedChoice
                  label={d.period}
                  value={draft.period}
                  onChange={(next) => set('period', next)}
                  options={[
                    { key: 'month', label: d.periods.month },
                    { key: 'year', label: d.periods.year },
                  ]}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="product-step">{d.workloadStep}</Label>
                <Input
                  id="product-step"
                  inputMode="numeric"
                  value={draft.workloadStep}
                  onChange={(event) => set('workloadStep', event.target.value)}
                />
              </div>
              <p className="self-center text-[13px] text-muted sm:col-span-4">{d.workloadHint}</p>
              <p className="text-xs text-muted sm:col-span-6">{d.vatHint(rate)}</p>
            </div>
          </Card>

          <Card>
            <CardHeader title={d.priceList} />
            <p className="px-5 pt-1.5 text-[13px] text-muted">{d.priceListHint}</p>
            <PricePart
              kind="role"
              rows={draft.rows}
              canWrite={canWrite}
              onAdd={() => setAdding('role')}
              setRow={setRow}
              move={move}
              removeRow={removeRow}
              pair={pair}
            />
            <div className="mt-3 h-2 border-y border-border-subtle bg-surface" />
            <PricePart
              kind="other"
              rows={draft.rows}
              canWrite={canWrite}
              onAdd={() => setAdding('other')}
              setRow={setRow}
              move={move}
              removeRow={removeRow}
              pair={pair}
            />
            <p className="mt-3 border-t border-border-subtle px-5 py-3 text-[13px] text-muted">
              {d.sharedNames}{' '}
              <Link
                to="/products/roles"
                className="font-semibold text-primary-text hover:underline"
              >
                {sk.products.tabs.roles}
              </Link>{' '}
              {d.and}{' '}
              <Link
                to="/products/others"
                className="font-semibold text-primary-text hover:underline"
              >
                {sk.products.tabs.others}
              </Link>
              .
            </p>
          </Card>

          {product ? <HoldersCard product={product} /> : null}
        </div>
        <div className="min-w-0 space-y-5">
          <Calculator
            draft={draft}
            input={input}
            rate={rate}
            canWrite={canWrite}
            customers={product?.customers ?? 0}
            onInsert={(changes) =>
              setDraft((current) => ({
                ...current,
                rows: current.rows.map((row) => {
                  const change = changes.find((c) => c.itemId === row.itemId);
                  return change ? { ...row, included: String(change.to) } : row;
                }),
              }))
            }
          />
        </div>
      </main>

      {adding ? (
        <AddItemDialog
          kind={adding}
          productName={draft.name || d.newTitle}
          productId={product?.id}
          taken={draft.rows.map((r) => r.itemId)}
          onClose={() => setAdding(null)}
          onAdd={(row) => setDraft((c) => ({ ...c, rows: rolesFirst([...c.rows, row]) }))}
          rate={rate}
        />
      ) : null}
      {deleting && product ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(false)}
          title={d.deleteConfirm.title(product.name)}
          description={d.deleteConfirm.text}
          confirmLabel={d.deleteConfirm.confirm}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ id: product.id })}
        />
      ) : null}
    </div>
  );
}

/** One part of the Cenník (R-22): its heading, its button and its table. */
function PricePart({
  kind,
  rows,
  canWrite,
  onAdd,
  setRow,
  move,
  removeRow,
  pair,
}: {
  kind: ProductItemKind;
  rows: Row[];
  canWrite: boolean;
  onAdd: () => void;
  setRow: (index: number, patch: Partial<Row>) => void;
  move: (index: number, by: number) => void;
  removeRow: (index: number) => void;
  pair: (text: string, gross: boolean) => { net: string; gross: string };
}) {
  const t = d.parts[kind];
  const part = rows.flatMap((row, index) => (row.kind === kind ? [{ row, index }] : []));
  return (
    <section aria-label={t.title}>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-5">
        <div>
          <h3 className="text-[15px] font-semibold">{t.title}</h3>
          <p className="text-xs text-muted">{t.hint}</p>
        </div>
        {canWrite ? (
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <Plus className="size-3.5" aria-hidden />
            {t.add}
          </Button>
        ) : null}
      </div>
      {part.length === 0 ? (
        <p className="px-5 pt-2 text-sm text-muted">{t.empty}</p>
      ) : (
        <div className="mt-2.5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border-subtle bg-surface text-left text-xs text-muted">
                <th className="w-14 py-2 pl-5" />
                <th className="px-2 py-2 font-semibold">{t.column}</th>
                <th className="px-2 py-2 font-semibold">{d.columns.billing}</th>
                <th className="px-2 py-2 font-semibold">{d.columns.included}</th>
                <th className="px-2 py-2 font-semibold">{d.columns.unitNet}</th>
                <th className="px-2 py-2 font-semibold">{d.columns.unitGross}</th>
                <th className="px-2 py-2 font-semibold">{d.columns.max}</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {part.map(({ row, index }, place) => (
                <tr
                  key={row.itemId}
                  className="group/row border-t border-border-subtle first:border-t-0"
                >
                  <td className="py-2 pl-3">
                    <RowActions className="flex-col gap-0">
                      <button
                        type="button"
                        aria-label={d.moveUp}
                        disabled={place === 0}
                        onClick={() => move(index, -1)}
                        className="text-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={d.moveDown}
                        disabled={place === part.length - 1}
                        onClick={() => move(index, 1)}
                        className="text-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="size-4" aria-hidden />
                      </button>
                    </RowActions>
                  </td>
                  <td className="px-2 py-2">
                    <span className="block font-semibold">{row.name}</span>
                    {row.unit ? (
                      <span className="block text-xs text-muted">{d.unit(row.unit)}</span>
                    ) : null}
                    {kind === 'role' ? (
                      <span className="mt-1 block">
                        <AppChips apps={row.apps} />
                      </span>
                    ) : null}
                    {kind === 'role' && row.billing === 'recurring' ? (
                      <span className="mt-1 flex items-center gap-1.5 text-xs whitespace-nowrap text-muted">
                        <Switch
                          checked={row.byWorkload}
                          label={`${row.name}: ${d.byWorkload}`}
                          onChange={() => setRow(index, { byWorkload: !row.byWorkload })}
                        />
                        {d.byWorkload}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <Select
                      aria-label={`${row.name}: ${d.columns.billing}`}
                      value={row.billing}
                      onChange={(value) => setRow(index, { billing: value as ItemBilling })}
                      className="h-9 w-36"
                    >
                      <SelectItem value="recurring">{d.billings.recurring}</SelectItem>
                      <SelectItem value="once">{d.billings.once}</SelectItem>
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`${row.name}: ${d.columns.included}`}
                      inputMode="numeric"
                      value={row.included}
                      onChange={(event) => setRow(index, { included: event.target.value })}
                      className="h-9 w-16 text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`${row.name}: ${d.columns.unitNet}`}
                      inputMode="decimal"
                      value={row.unitPrice}
                      onChange={(event) => {
                        const both = pair(event.target.value, false);
                        setRow(index, { unitPrice: both.net, unitPriceGross: both.gross });
                      }}
                      className="h-9 w-24 bg-surface text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`${row.name}: ${d.columns.unitGross}`}
                      inputMode="decimal"
                      value={row.unitPriceGross}
                      onChange={(event) => {
                        const both = pair(event.target.value, true);
                        setRow(index, { unitPrice: both.net, unitPriceGross: both.gross });
                      }}
                      className="h-9 w-24 text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`${row.name}: ${d.columns.max}`}
                      inputMode="numeric"
                      value={row.max}
                      onChange={(event) => setRow(index, { max: event.target.value })}
                      className="h-9 w-16 text-right"
                    />
                  </td>
                  <td className="pr-3">
                    <RowActions>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={d.remove(row.name)}
                        onClick={() => removeRow(index)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** A count of the calculator that differs from the price list's „V cene“. */
interface InsertChange {
  itemId: string;
  name: string;
  from: number;
  to: number;
}

/**
 * Výpočet ceny (R-6): counts per item, the totals monthly, yearly and once. It stores nothing by
 * itself; „Vložiť do cenníka“ writes the counts of recurring items to the form, once confirmed (R-24).
 */
function Calculator({
  draft,
  input,
  rate,
  canWrite,
  customers,
  onInsert,
}: {
  draft: Draft;
  input: {
    basePrice: number | null;
    period: ProductPeriod;
    items: {
      itemId: string;
      included: number;
      unitPrice: number | null;
      max: number | null;
      billing: ItemBilling;
    }[];
  };
  rate: number;
  canWrite: boolean;
  customers: number;
  onInsert: (changes: InsertChange[]) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [inserted, setInserted] = useState(false);
  const t = d.insert;
  const changes: InsertChange[] = input.items.flatMap((item, index) => {
    const to = counts[item.itemId];
    return item.billing === 'recurring' && to !== undefined && to !== item.included
      ? [{ itemId: item.itemId, name: draft.rows[index]?.name ?? '', from: item.included, to }]
      : [];
  });
  const countOf = (itemId: string, included: number) => counts[itemId] ?? included;
  const price = priceOf(
    { basePrice: input.basePrice, items: input.items },
    Object.fromEntries(
      input.items.map((i) => [i.itemId, countOf(i.itemId, i.billing === 'once' ? 0 : i.included)]),
    ),
  );
  const monthly = input.period === 'month' ? price.recurring : price.recurring / 12;
  const yearly = input.period === 'month' ? price.recurring * 12 : price.recurring;
  const round = (n: number) => Math.round(n * 100) / 100;
  const rows: [string, number][] = [
    [d.monthly, round(monthly)],
    [d.yearly, round(yearly)],
    [d.once, price.once],
  ];
  return (
    <Card>
      <CardHeader
        title={d.calculator}
        action={<span className="text-xs text-muted">{d.calculatorHint}</span>}
      />
      <div className="px-5 pt-2 pb-5">
        {input.items.map((item, index) => {
          const count = countOf(item.itemId, item.billing === 'once' ? 0 : item.included);
          const name = draft.rows[index]?.name ?? '';
          const step = (by: number) => {
            setInserted(false);
            setCounts((c) => ({
              ...c,
              [item.itemId]: Math.max(0, Math.min(item.max ?? 100_000, count + by)),
            }));
          };
          return (
            <div
              key={item.itemId}
              className="flex items-center gap-3 border-t border-border-subtle py-2.5 first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{name}</span>
                <span className="block text-xs text-muted">
                  {item.billing === 'once' ? d.billings.once : d.inPackage(item.included)}
                </span>
              </span>
              <Button size="icon" variant="secondary" aria-label={d.less} onClick={() => step(-1)}>
                −
              </Button>
              <span className="w-8 text-center font-semibold tabular-nums">{count}</span>
              <Button size="icon" variant="secondary" aria-label={d.more} onClick={() => step(1)}>
                +
              </Button>
            </div>
          );
        })}
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1 text-left font-semibold">{d.total}</th>
              <th className="py-1 text-right font-semibold">{d.withoutVat}</th>
              <th className="py-1 text-right font-semibold">{d.withVat(rate)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, net]) => (
              <tr key={label} className="border-t border-border-subtle">
                <td className="py-2 font-semibold">{label}</td>
                <td className="py-2 text-right tabular-nums">{formatEur(net)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  {formatEur(withVat(net, rate))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canWrite && changes.length > 0 ? (
          <Button variant="secondary" className="mt-3.5 w-full" onClick={() => setConfirming(true)}>
            {t.button}
          </Button>
        ) : null}
        {inserted ? (
          <p className="mt-3.5 rounded-xl bg-success-soft px-3 py-2.5 text-[13px] text-success">
            {t.done}
          </p>
        ) : null}
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border-subtle bg-surface text-xs text-muted">
                <th className="px-2 py-2 text-left font-semibold">{t.item}</th>
                <th className="px-2 py-2 text-right font-semibold">{t.from}</th>
                <th className="px-2 py-2 text-right font-semibold">{t.to}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.itemId} className="border-b border-border-subtle">
                  <td className="px-2 py-2 font-semibold">{change.name}</td>
                  <td className="px-2 py-2 text-right text-muted tabular-nums">{change.from}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{change.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {customers > 0 ? (
            <p className="rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
              {t.warning(customers)}
            </p>
          ) : null}
          <p className="text-[13px] text-muted">{t.note}</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {sk.common.cancel}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onInsert(changes);
                setCounts((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(
                      ([itemId]) => !changes.some((change) => change.itemId === itemId),
                    ),
                  ),
                );
                setConfirming(false);
                setInserted(true);
              }}
            >
              {t.button}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Majú ho: the organizations and prevádzky that hold the product. */
function HoldersCard({ product }: { product: Product }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const holders = useQuery({
    ...trpc.product.holders.queryOptions({ id: product.id, search, page }),
    placeholderData: keepPreviousData,
  });
  const items = holders.data?.items ?? [];
  return (
    <Card>
      <CardHeader
        title={
          <>
            {d.holders}
            <span className="ml-1.5 font-normal text-muted">· {product.customers}</span>
          </>
        }
      />
      {product.customers === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">{d.holdersEmpty}</p>
      ) : (
        <>
          <div className="relative mx-5 mt-3 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              aria-label={d.holdersSearch}
              placeholder={d.holdersSearch}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="h-9 pl-9"
            />
          </div>
          {items.length === 0 && !holders.isPending ? (
            <p className="px-5 py-5 text-sm text-muted">{d.holdersNothing}</p>
          ) : (
            <ul className={cn('px-5 pt-2 pb-2', holders.isPlaceholderData && 'opacity-60')}>
              {items.map((holder) => (
                <li
                  key={holder.id}
                  className="flex items-center justify-between gap-3 border-t border-border-subtle py-2.5 text-sm first:border-t-0"
                >
                  <span className="min-w-0">
                    <Link
                      to="/organizations/$customerId"
                      params={{ customerId: holder.id }}
                      className="font-semibold hover:underline"
                    >
                      {holder.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      {[
                        holder.parentName ? d.establishmentOf(holder.parentName) : d.organization,
                        holder.scope,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {holder.monthlyGross !== null ? (
                    <span className="shrink-0 text-right tabular-nums">
                      <span className="block font-semibold">
                        {d.perMonth(formatEur(holder.monthlyGross))}
                      </span>
                      <span className="block text-xs text-muted">
                        {d.perYear(formatEur(holder.yearlyGross ?? 0))}
                      </span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <TablePagination
            page={page}
            pageSize={HOLDERS_PAGE_SIZE}
            total={holders.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </Card>
  );
}

/**
 * Pridať rolu or Pridať položku (docs/products.md 7): one kind of the shared catalog with where each
 * is used; picking one takes over the numbers of the product it was last used in; the button at the
 * bottom makes a new one.
 */
function AddItemDialog({
  kind,
  productName,
  productId,
  taken,
  onClose,
  onAdd,
  rate,
}: {
  kind: ProductItemKind;
  productName: string;
  productId: string | undefined;
  taken: string[];
  onClose: () => void;
  onAdd: (row: Row) => void;
  rate: number;
}) {
  const items = useQuery(trpc.product.items.queryOptions());
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [takeOver, setTakeOver] = useState(true);
  const [creating, setCreating] = useState(false);
  const term = search.trim().toLocaleLowerCase('sk');
  const list = (items.data ?? []).filter(
    (item) => item.kind === kind && (!term || item.name.toLocaleLowerCase('sk').includes(term)),
  );
  const pickedItem = list.find((i) => i.id === picked) ?? items.data?.find((i) => i.id === picked);
  const elsewhere = (item: CatalogItem) => item.usedIn.find((u) => u.productId !== productId);
  const source = pickedItem ? elsewhere(pickedItem) : undefined;
  const [fields, setFields] = useState({
    included: '0',
    unitGross: '',
    max: '',
    billing: 'recurring' as ItemBilling,
  });
  useEffect(() => {
    if (source && takeOver)
      setFields({
        included: String(source.included),
        unitGross: moneyText(source.unitPriceGross),
        max: source.max === null ? '' : String(source.max),
        billing: source.billing,
      });
  }, [source, takeOver]);
  const describe = (item: CatalogItem) => {
    const use = elsewhere(item);
    if (!use) return sk.products.itemDialog.unused;
    const parts = [
      use.billing === 'once' ? d.billings.once.toLocaleLowerCase('sk') : `${use.included} v cene`,
      use.unitPriceGross === null
        ? null
        : `${use.included > 0 && use.billing === 'recurring' ? '+' : ''}${formatEur(use.unitPriceGross)}`,
      use.max === null ? null : `max. ${use.max}`,
    ].filter(Boolean);
    return sk.products.itemDialog.usedIn(use.product, parts.join(', '));
  };
  const add = () => {
    if (!pickedItem) return;
    const gross = parseMoney(fields.unitGross);
    onAdd({
      itemId: pickedItem.id,
      kind: pickedItem.kind,
      apps: pickedItem.apps,
      name: pickedItem.name,
      unit: pickedItem.unit,
      billing: fields.billing,
      included: fields.included,
      unitPrice: gross === null ? '' : moneyText(withoutVat(gross, rate)),
      unitPriceGross: fields.unitGross,
      max: fields.max,
      byWorkload: false,
    });
    onClose();
  };
  const t = sk.products.itemDialog;
  const copy = t[kind];
  const sorted = useMemo(() => list, [list]);
  return (
    <>
      <Dialog open={!creating} onOpenChange={(open) => !open && onClose()}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description(productName)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                aria-label={copy.search}
                placeholder={copy.search}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {sorted.map((item) => {
                const isTaken = taken.includes(item.id);
                return (
                  <li key={item.id}>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5',
                        isTaken ? 'opacity-55' : 'cursor-pointer',
                        picked === item.id && 'border-primary bg-primary-soft/40',
                      )}
                    >
                      <input
                        type="radio"
                        name="item"
                        aria-label={item.name}
                        disabled={isTaken}
                        checked={picked === item.id}
                        onChange={() => setPicked(item.id)}
                        className="size-4 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">
                          {item.name}
                          {item.unit ? (
                            <span className="font-normal text-muted"> · {item.unit}</span>
                          ) : null}
                        </span>
                        <span className="block text-xs text-muted">
                          {isTaken ? t.already : describe(item)}
                        </span>
                      </span>
                      {kind === 'role' ? <AppChips apps={item.apps} /> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
            {pickedItem ? (
              <div className="grid gap-3 rounded-xl border border-border-subtle p-3 sm:grid-cols-4">
                <p className="text-sm font-semibold sm:col-span-4">
                  {pickedItem.name} · {productName}
                </p>
                {source ? (
                  <label className="flex items-center gap-2 text-sm sm:col-span-4">
                    <input
                      type="checkbox"
                      checked={takeOver}
                      onChange={() => setTakeOver(!takeOver)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    {t.takeOver(source.product)}
                  </label>
                ) : null}
                <div className="sm:col-span-4">
                  <SegmentedChoice
                    label={d.columns.billing}
                    value={fields.billing}
                    onChange={(billing) => setFields({ ...fields, billing })}
                    options={[
                      { key: 'recurring', label: d.billings.recurring },
                      { key: 'once', label: d.billings.once },
                    ]}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="add-included">{d.columns.included}</Label>
                  <Input
                    id="add-included"
                    value={fields.included}
                    onChange={(e) => setFields({ ...fields, included: e.target.value })}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="add-gross">{`${d.columns.unitNet.replace('bez DPH', '')}${d.withVat(rate)} (€)`}</Label>
                  <Input
                    id="add-gross"
                    inputMode="decimal"
                    value={fields.unitGross}
                    onChange={(e) => setFields({ ...fields, unitGross: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="add-max">{d.columns.max}</Label>
                  <Input
                    id="add-max"
                    value={fields.max}
                    onChange={(e) => setFields({ ...fields, max: e.target.value })}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {copy.newItem}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {sk.common.cancel}
              </Button>
              <Button type="button" disabled={!pickedItem} onClick={add}>
                {t.add}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {creating ? (
        <ItemDialog
          kind={kind}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setPicked(id);
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
}
