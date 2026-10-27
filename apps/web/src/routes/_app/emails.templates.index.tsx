import { sk } from '@intra/shared/i18n';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Mail, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.templates;

export const Route = createFileRoute('/_app/emails/templates/')({
  validateSearch: z.object({
    category: z.string().optional(),
    q: z.string().optional(),
  }),
  component: TemplatesPage,
});

/** The colours of the category badges, by order: offer, news, invitation, follow-up, … */
const CATEGORY_CLASS = [
  'bg-[#fcf0de] text-[#b45309]',
  'bg-[#e9eef6] text-[#334e7b]',
  'bg-[#eeedfe] text-[#3c3489]',
  'bg-primary-soft text-primary-text',
  'bg-[#eaf3de] text-[#3b6d11]',
];

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function TemplatesPage() {
  const params = Route.useSearch();
  const navigate = Route.useNavigate();
  const canWrite = useCan('template.write');
  const [typed, setTyped] = useState(params.q ?? '');
  const search = useDebounced(typed.trim(), 300);
  const look = useQuery(trpc.template.look.queryOptions());
  const list = useQuery({
    ...trpc.template.list.queryOptions({
      ...(params.category ? { categoryId: params.category } : {}),
      ...(search ? { search } : {}),
    }),
    placeholderData: keepPreviousData,
  });
  const categories = list.data?.categories ?? [];
  const classOf = (id: string | null) => {
    const i = categories.findIndex((c) => c.id === id);
    return i < 0 ? 'bg-track text-muted' : CATEGORY_CLASS[i % CATEGORY_CLASS.length];
  };
  const setCategory = (category: string | undefined) =>
    void navigate({ search: (prev) => ({ ...prev, category }), replace: true });

  const chips = list.data
    ? [
        { key: undefined, label: t.filters.all(list.data.counts.all) },
        ...categories
          .filter((c) => c.active || list.data.counts.byCategory[c.id])
          .map((c) => ({
            key: c.id,
            label: t.filters.category(c.name, list.data.counts.byCategory[c.id] ?? 0),
          })),
        ...(list.data.counts.inactive > 0
          ? [{ key: 'inactive', label: t.filters.inactive(list.data.counts.inactive) }]
          : []),
      ]
    : [];

  return (
    <div className="min-w-0">
      <PageHeader
        title={t.title}
        subtitle={look.data ? sk.emails.subtitle(look.data.senderAddress) : undefined}
      >
        {canWrite ? (
          <Button asChild>
            <Link to="/emails/templates/$templateId" params={{ templateId: 'new' }}>
              <Plus className="size-4" aria-hidden />
              {t.new}
            </Link>
          </Button>
        ) : null}
      </PageHeader>
      <main className="max-w-[1440px] space-y-4 px-7 pt-5 pb-10">
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label={t.filters.label} className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.key ?? 'all'}
                type="button"
                role="tab"
                aria-selected={params.category === chip.key}
                onClick={() => setCategory(chip.key)}
                className={cn(
                  'h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors',
                  params.category === chip.key
                    ? 'border-primary bg-primary-soft text-primary-text'
                    : 'border-border bg-white text-muted hover:bg-hover',
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <label className="ml-auto flex h-9 w-full max-w-72 items-center gap-2 rounded-[10px] border border-border bg-white px-3 focus-within:border-primary">
            <Search className="size-[15px] shrink-0 text-tertiary" aria-hidden />
            <span className="sr-only">{t.searchLabel}</span>
            <input
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={t.searchLabel}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-tertiary"
            />
          </label>
        </div>

        {list.isPending ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </div>
        ) : loadFailed(list) ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            title={params.category || search ? t.emptyFiltered : t.empty}
            text={params.category || search ? undefined : t.emptyText}
          />
        ) : (
          <ul
            className={cn(
              'grid gap-4 md:grid-cols-2 xl:grid-cols-3',
              list.isPlaceholderData && 'opacity-60',
            )}
          >
            {list.data.items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/emails/templates/$templateId"
                  params={{ templateId: item.id }}
                  className={cn(
                    'flex h-full flex-col overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-rest transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-raised',
                    !item.active && 'opacity-70',
                  )}
                >
                  <div
                    aria-hidden
                    className={cn(
                      'flex h-16 items-center gap-2 px-5',
                      item.active ? 'bg-[linear-gradient(135deg,#104b4c,#0c3b3c)]' : 'bg-[#c5d3d1]',
                    )}
                  >
                    <Mail className="size-4 text-white/80" />
                    <span className="h-1.5 w-24 rounded-full bg-white/30" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={classOf(item.categoryId)}>
                        {item.categoryName ?? t.noCategory}
                      </Badge>
                      {item.active ? null : <Badge tone="neutral">{t.inactive}</Badge>}
                    </div>
                    <p className="text-[15px] font-semibold">{item.name}</p>
                    <p className="line-clamp-2 text-[13px] text-muted">{item.subject}</p>
                    <p className="mt-auto pt-2 text-xs text-tertiary">
                      {item.updatedBy
                        ? t.meta(item.updatedBy, formatDate(item.updatedAt))
                        : t.metaPlain(formatDate(item.updatedAt))}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
