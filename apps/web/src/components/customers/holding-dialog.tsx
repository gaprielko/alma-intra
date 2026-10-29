import { sk } from '@intra/shared/i18n';
import {
  countFromWorkloads,
  heldPrice,
  type ProductPricing,
  toCents,
  withoutVat,
  withVat,
} from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { formatEur, moneyText, parseMoney } from '@/components/products/products-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedChoice } from '@/components/ui/segmented';
import { Select, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const d = sk.holdings.dialog;
const w = sk.holdings.workloads;

export type Holding = RouterOutputs['customer']['holdings'][number];
type Product = RouterOutputs['product']['list'][number];
type Workload = { persons: number; percent: number };

const today = () => new Date().toISOString().slice(0, 10);

/** The months after `from` a discount lasts, as a date: „zľava do 31. 1. 2027“. */
function discountEnd(from: string, months: number) {
  const date = new Date(`${from}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  date.setDate(date.getDate() - 1);
  return formatDate(date);
}

/**
 * „Prideliť produkt“ (docs/products.md 9.2): for the organization or one of its prevádzky, the
 * product, its dates, the counts above the package (workloads for such items), and how it is
 * priced; the price is computed as it is typed. With `holding`, „Upraviť produkt“.
 */
export function HoldingDialog({
  organizationId,
  organizationName,
  holders,
  holding,
  taken,
  onClose,
}: {
  organizationId: string;
  organizationName: string;
  /** Who may hold it: the organization and its prevádzky (a prevádzka alone: itself). */
  holders: { id: string; name: string; isEstablishment: boolean }[];
  holding?: Holding | undefined;
  /** What each holder holds already („holder:product“): not offered to it again. */
  taken?: ReadonlySet<string> | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const products = useQuery(trpc.product.list.queryOptions());
  const vat = useQuery(trpc.product.vatRate.queryOptions());
  const rate = vat.data?.vatRate ?? 23;

  const [holderId, setHolderId] = useState(holding?.organizationId ?? organizationId);
  const [productId, setProductId] = useState<string | null>(holding?.productId ?? null);
  const [search, setSearch] = useState('');
  const [validFrom, setValidFrom] = useState(holding?.validFrom ?? today());
  const [validTo, setValidTo] = useState(holding?.validTo ?? '');
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(holding?.items.map((i) => [i.itemId, i.count]) ?? []),
  );
  const [workloads, setWorkloads] = useState<Record<string, Workload[]>>(() =>
    Object.fromEntries(
      holding?.items.filter((i) => i.byWorkload).map((i) => [i.itemId, i.workloads]) ?? [],
    ),
  );
  const [pricing, setPricing] = useState<ProductPricing>(holding?.pricing ?? 'list');
  const [discount, setDiscount] = useState(
    holding?.discountPercent === null || holding?.discountPercent === undefined
      ? ''
      : String(holding.discountPercent),
  );
  const [permanent, setPermanent] = useState(holding ? holding.discountMonths === null : true);
  const [months, setMonths] = useState(String(holding?.discountMonths ?? 6));
  const [fixedNet, setFixedNet] = useState(moneyText(holding?.fixedPrice));
  const [fixedGross, setFixedGross] = useState(moneyText(holding?.fixedPriceGross));
  const [note, setNote] = useState(holding?.note ?? '');
  const [editingWorkloads, setEditingWorkloads] = useState<string | null>(null);

  const save = useMutation(
    trpc.customer.holdingSave.mutationOptions({
      onSuccess: async () => {
        toast('success', d.saved);
        await Promise.all([
          queryClient.invalidateQueries(trpc.customer.pathFilter()),
          queryClient.invalidateQueries(trpc.product.pathFilter()),
        ]);
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, sk.holdings.errors)),
    }),
  );

  const all = products.data ?? [];
  const product: Product | undefined = all.find((p) => p.id === productId);
  const term = search.trim().toLocaleLowerCase('sk');
  const offered = all.filter(
    (p) =>
      (p.active || p.id === productId) &&
      !taken?.has(`${holderId}:${p.id}`) &&
      (!term ||
        p.name.toLocaleLowerCase('sk').includes(term) ||
        (p.description ?? '').toLocaleLowerCase('sk').includes(term)),
  );

  const pick = (next: Product) => {
    setProductId(next.id);
    setCounts({});
    setWorkloads({});
  };

  const discountPercent = pricing === 'discount' ? parseMoney(discount) : null;
  const discountMonths = pricing === 'discount' && !permanent ? Number(months) || null : null;
  const fixedPrice =
    pricing === 'fixed'
      ? (parseMoney(fixedNet) ??
        (parseMoney(fixedGross) === null ? null : withoutVat(parseMoney(fixedGross)!, rate)))
      : null;
  const price = product
    ? heldPrice(
        {
          product: {
            basePrice: product.basePrice,
            period: product.period,
            workloadStep: product.workloadStep,
            items: product.items,
          },
          counts,
          workloads,
          pricing,
          discountPercent,
          discountMonths,
          fixedPrice,
          validFrom,
        },
        new Date(`${validFrom}T00:00:00`),
      )
    : null;

  const valid =
    product !== undefined &&
    /^\d{4}-\d{2}-\d{2}$/.test(validFrom) &&
    (validTo === '' || validTo >= validFrom) &&
    (pricing !== 'discount' || (discountPercent !== null && discountPercent <= 100)) &&
    (pricing !== 'fixed' || fixedPrice !== null);

  const submit = () => {
    if (!product || !price) return;
    save.mutate({
      organizationId: holderId,
      productId: product.id,
      validFrom,
      validTo: validTo || null,
      pricing,
      discountPercent,
      discountMonths,
      fixedPrice: pricing === 'fixed' ? parseMoney(fixedNet) : null,
      fixedPriceGross: pricing === 'fixed' ? parseMoney(fixedGross) : null,
      note,
      counts: product.items
        .filter((i) => !i.byWorkload)
        .map((i) => ({ itemId: i.itemId, count: price.counts[i.itemId] ?? 0 })),
      workloads: product.items.flatMap((i) =>
        i.byWorkload ? (workloads[i.itemId] ?? []).map((x) => ({ itemId: i.itemId, ...x })) : [],
      ),
    });
  };

  // The summary: before and with a discount, the first year, the one-off items.
  const summary: [string, number][] = [];
  if (price) {
    if (pricing === 'discount') {
      const discounted = discountMonths === null ? 12 : Math.min(12, discountMonths);
      summary.push([d.summary.before, price.listMonthly]);
      summary.push([d.summary.withDiscount, price.monthly]);
      summary.push([
        d.summary.firstYear,
        toCents(price.monthly * discounted + price.listMonthly * (12 - discounted)),
      ]);
    } else {
      summary.push([d.summary.monthly, price.monthly]);
      summary.push([d.summary.yearly, price.yearly]);
    }
    if (product?.items.some((i) => i.billing === 'once'))
      summary.push([d.summary.once, price.once]);
  }
  const workloadItem = product?.items.find((i) => i.itemId === editingWorkloads);

  return (
    <Dialog open onOpenChange={(open) => !open && !editingWorkloads && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{holding ? d.editTitle : d.title}</DialogTitle>
          <DialogDescription>{d.description(organizationName)}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            // Opened from the organization's form: its submit must not reach that form too.
            event.stopPropagation();
            submit();
          }}
        >
          {holders.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="holding-holder">{d.for}</Label>
              <Select
                id="holding-holder"
                value={holderId}
                onChange={(id) => {
                  setHolderId(id);
                  if (taken?.has(`${id}:${productId}`)) setProductId(null);
                }}
                disabled={holding !== undefined}
              >
                {holders.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {`${h.name} · ${h.isEstablishment ? d.establishment : d.organization}`}
                  </SelectItem>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-semibold">{d.product}</p>
            {holding ? null : (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <Input
                  aria-label={d.search}
                  placeholder={d.search}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9"
                />
              </div>
            )}
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {(holding ? all.filter((p) => p.id === productId) : offered).map((p) => (
                <li key={p.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5',
                      productId === p.id && 'border-primary bg-primary-soft/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="product"
                      aria-label={p.name}
                      checked={productId === p.id}
                      disabled={holding !== undefined}
                      onChange={() => pick(p)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{p.name}</span>
                      {p.description ? (
                        <span className="block truncate text-xs text-muted">{p.description}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {p.active
                        ? p.basePrice === null
                          ? null
                          : d.from(formatEur(p.period === 'month' ? p.basePrice : p.basePrice / 12))
                        : d.withdrawn}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="holding-from">{d.validFrom}</Label>
              <Input
                id="holding-from"
                type="date"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holding-to">{d.validTo}</Label>
              <Input
                id="holding-to"
                type="date"
                value={validTo}
                min={validFrom}
                onChange={(event) => setValidTo(event.target.value)}
              />
            </div>
          </div>

          {product && price && product.items.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                {d.scope}
                <span className="ml-2 text-xs font-normal text-muted">{d.scopeHint}</span>
              </p>
              <div className="overflow-x-auto rounded-xl border border-border-subtle">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th className="px-3 py-2 text-left font-semibold">{d.columns.item}</th>
                      <th className="px-3 py-2 text-center font-semibold">{d.columns.count}</th>
                      <th className="px-3 py-2 text-right font-semibold">{d.columns.unit}</th>
                      <th className="px-3 py-2 text-right font-semibold">{d.columns.extra}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.items.map((item) => {
                      const once = item.billing === 'once';
                      const floor = once ? 0 : item.included;
                      const count = price.counts[item.itemId] ?? floor;
                      const extra = once ? count : Math.max(0, count - item.included);
                      const step = (by: number) =>
                        setCounts((c) => ({
                          ...c,
                          [item.itemId]: Math.max(floor, Math.min(item.max ?? 100_000, count + by)),
                        }));
                      return (
                        <tr key={item.itemId} className="border-t border-border-subtle">
                          <td className="px-3 py-2">
                            <span className="block font-semibold">{item.name}</span>
                            <span className="block text-xs text-muted">
                              {[
                                once
                                  ? d.once
                                  : item.included > 0
                                    ? d.inPackage(item.included)
                                    : d.notInPackage,
                                item.max === null ? null : d.max(item.max),
                                item.byWorkload ? d.byWorkload : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {item.byWorkload ? (
                              <div className="flex items-center justify-center gap-2">
                                <span className="w-8 text-center font-semibold tabular-nums">
                                  {count}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setEditingWorkloads(item.itemId)}
                                >
                                  <Users className="size-3.5" aria-hidden />
                                  {d.workloads}
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-2">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="secondary"
                                  aria-label={`${d.less}: ${item.name}`}
                                  disabled={count <= floor}
                                  onClick={() => step(-1)}
                                >
                                  −
                                </Button>
                                <span className="w-8 text-center font-semibold tabular-nums">
                                  {count}
                                </span>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="secondary"
                                  aria-label={`${d.more}: ${item.name}`}
                                  disabled={
                                    (item.max !== null && count >= item.max) ||
                                    (item.unitPrice === null && count >= item.included && !once)
                                  }
                                  onClick={() => step(1)}
                                >
                                  +
                                </Button>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap text-muted tabular-nums">
                            {item.unitPrice === null ? sk.common.none : formatEur(item.unitPrice)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums">
                            {formatEur(toCents(extra * (item.unitPrice ?? 0)))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {product ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold">{d.price}</p>
              <SegmentedChoice
                label={d.price}
                value={pricing}
                onChange={setPricing}
                options={(['list', 'discount', 'fixed'] as const).map((key) => ({
                  key,
                  label: d.modes[key],
                }))}
              />
              {pricing === 'discount' ? (
                <div className="grid items-end gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="holding-discount">{d.discount}</Label>
                    <Input
                      id="holding-discount"
                      inputMode="decimal"
                      value={discount}
                      onChange={(event) => setDiscount(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="block text-sm font-medium">{d.duration}</span>
                    <span className="flex h-10 items-center gap-2 text-sm">
                      <Switch
                        checked={permanent}
                        label={d.permanent}
                        onChange={() => setPermanent(!permanent)}
                      />
                      {d.permanent}
                    </span>
                  </div>
                  {permanent ? null : (
                    <div className="space-y-1.5">
                      <Label htmlFor="holding-months">{d.months}</Label>
                      <Input
                        id="holding-months"
                        inputMode="numeric"
                        value={months}
                        onChange={(event) => setMonths(event.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                  )}
                  {!permanent && discountMonths ? (
                    <p className="text-xs text-muted sm:col-span-3">
                      {d.discountUntil(discountEnd(validFrom, discountMonths))}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {pricing === 'fixed' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="holding-fixed">{d.fixedNet}</Label>
                    <Input
                      id="holding-fixed"
                      inputMode="decimal"
                      value={fixedNet}
                      onChange={(event) => {
                        setFixedNet(event.target.value);
                        const net = parseMoney(event.target.value);
                        setFixedGross(net === null ? '' : moneyText(withVat(net, rate)));
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="holding-fixed-gross">{d.fixedGross(rate)}</Label>
                    <Input
                      id="holding-fixed-gross"
                      inputMode="decimal"
                      value={fixedGross}
                      onChange={(event) => {
                        setFixedGross(event.target.value);
                        const gross = parseMoney(event.target.value);
                        setFixedNet(gross === null ? '' : moneyText(withoutVat(gross, rate)));
                      }}
                    />
                  </div>
                </div>
              ) : null}
              <table className="w-full rounded-xl bg-surface text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="px-3 py-2 text-left font-semibold">{d.summary.head}</th>
                    <th className="px-3 py-2 text-right font-semibold">{d.summary.withoutVat}</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      {d.summary.withVat(rate)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map(([label, net]) => (
                    <tr key={label} className="border-t border-border-subtle">
                      <td className="px-3 py-2">{label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEur(net)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatEur(withVat(net, rate))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="holding-note">{d.note}</Label>
            <Textarea
              id="holding-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {save.isPending ? sk.common.saving : holding ? sk.common.save : d.submit}
            </Button>
          </DialogFooter>
        </form>
        {product && workloadItem ? (
          <WorkloadsDialog
            item={workloadItem}
            productName={product.name}
            step={product.workloadStep}
            workloads={workloads[workloadItem.itemId] ?? []}
            onDone={(next) => {
              setWorkloads((all) => ({ ...all, [workloadItem.itemId]: next }));
              setEditingWorkloads(null);
            }}
            onClose={() => setEditingWorkloads(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * „Úväzky“ of one item (R-14, R-15): rows of how many persons work how much; each workload rounds
 * up to the product's step, the sum up to whole ones gives the count.
 */
function WorkloadsDialog({
  item,
  productName,
  step,
  workloads: initial,
  onDone,
  onClose,
}: {
  item: { name: string; included: number };
  productName: string;
  step: number;
  workloads: Workload[];
  onDone: (workloads: Workload[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Workload[]>(() =>
    initial.length > 0 ? initial : [{ persons: 1, percent: 100 }],
  );
  const rounded = (p: number) => Math.min(100, Math.ceil(p / step) * step);
  const total = countFromWorkloads(rows, step);
  const set = (index: number, row: Workload) =>
    setRows((all) => all.map((r, i) => (i === index ? row : r)));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" nested>
        <DialogHeader>
          <DialogTitle>{w.title(item.name)}</DialogTitle>
          <DialogDescription>{w.hint(step, productName)}</DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1 text-left font-semibold">{w.persons}</th>
              <th className="py-1 text-left font-semibold">{w.percent}</th>
              <th className="py-1 text-right font-semibold">{w.counted}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-border-subtle">
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      aria-label={w.fewer}
                      disabled={row.persons <= 1}
                      onClick={() => set(index, { ...row, persons: row.persons - 1 })}
                    >
                      −
                    </Button>
                    <span className="w-6 text-center font-semibold tabular-nums">
                      {row.persons}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      aria-label={w.morePersons}
                      onClick={() => set(index, { ...row, persons: row.persons + 1 })}
                    >
                      +
                    </Button>
                  </div>
                </td>
                <td className="py-2">
                  <span className="flex items-center gap-1.5">
                    <Input
                      aria-label={w.percent}
                      inputMode="numeric"
                      className="w-20"
                      value={String(row.percent)}
                      onChange={(event) => {
                        const n = Number(event.target.value.replace(/\D/g, '')) || 1;
                        set(index, { ...row, percent: Math.max(1, Math.min(100, n)) });
                      }}
                    />
                    %
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {row.persons} × {rounded(row.percent)} %
                </td>
                <td className="py-2 text-right">
                  <Button
                    type="button"
                    size="icon"
                    aria-label={w.remove}
                    disabled={rows.length <= 1}
                    onClick={() => setRows((all) => all.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setRows((all) => [...all, { persons: 1, percent: 100 }])}
          >
            {w.add}
          </Button>
          <span className="text-sm">
            <span className="font-semibold">{w.total(total.percent, total.count)}</span>
            <span className="ml-2 text-muted">
              {total.count > item.included
                ? w.over(total.count - item.included)
                : w.package(item.included)}
            </span>
          </span>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button type="button" onClick={() => onDone(rows)}>
            {w.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
