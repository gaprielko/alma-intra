import { sk } from '@intra/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const p = sk.products;

/** EUR as Slovak readers write it, to the cent: „60,27 €“. */
export const formatEur = (n: number) =>
  `${n.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** A typed price („9,84“ or „9.84“) as a number; empty or not a number: null. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** A price for an input field: „9,84“, empty for none. */
export const moneyText = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toFixed(2).replace('.', ',');

type Tab = 'products' | 'items';

/** Produkty: the page header and the tabs Produkty and Položky, each with its count. */
export function ProductsHeader({ active, children }: { active: Tab; children?: ReactNode }) {
  const products = useQuery(trpc.product.list.queryOptions());
  const items = useQuery(trpc.product.items.queryOptions());
  const tabs: { key: Tab; to: string; count: number | undefined }[] = [
    { key: 'products', to: '/products', count: products.data?.length },
    { key: 'items', to: '/products/items', count: items.data?.length },
  ];
  return (
    <>
      <PageHeader title={p.title} subtitle={p.subtitle}>
        {children}
      </PageHeader>
      <nav
        aria-label={p.title}
        className="flex gap-1 overflow-x-auto border-b border-border bg-white/80 px-7"
      >
        {tabs.map((tab) => {
          const on = tab.key === active;
          return (
            <Link
              key={tab.key}
              to={tab.to}
              aria-current={on ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex h-[46px] items-center gap-2 border-b-2 px-3.5 text-sm font-semibold whitespace-nowrap',
                on
                  ? 'border-primary text-primary-text'
                  : 'border-transparent text-muted hover:text-foreground',
              )}
            >
              {p.tabs[tab.key]}
              {tab.count === undefined ? null : (
                <span
                  className={cn(
                    'rounded-full px-2 text-xs font-semibold tabular-nums',
                    on ? 'bg-primary-soft text-primary-text' : 'bg-track text-muted',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
