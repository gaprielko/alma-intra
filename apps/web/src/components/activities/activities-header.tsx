import { sk } from '@intra/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.leadActivities;

type Tab = 'list' | 'types';

/** Aktivity: the page header and the tabs Zoznam and Typy aktivít, each with its count. */
export function ActivitiesHeader({
  active,
  count,
  children,
}: {
  active: Tab;
  /** The list's total as its page knows it, with its filters. */
  count?: number | undefined;
  children?: ReactNode;
}) {
  const types = useQuery(trpc.activityType.list.queryOptions());
  const all = useQuery({
    ...trpc.leadActivity.list.queryOptions({ page: 1 }),
    enabled: active !== 'list',
  });
  const tabs: { key: Tab; to: string; count: number | undefined }[] = [
    { key: 'list', to: '/activities', count: active === 'list' ? count : all.data?.total },
    { key: 'types', to: '/activities/types', count: types.data?.length },
  ];
  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={active === 'list' ? t.subtitle : sk.activityTypes.subtitle}
      >
        {children}
      </PageHeader>
      <nav
        aria-label={t.title}
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
              {t.tabs[tab.key]}
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
