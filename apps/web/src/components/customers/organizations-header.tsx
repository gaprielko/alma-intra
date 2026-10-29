import { sk } from '@intra/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const o = sk.organizations;

type Tab = 'customers' | 'partners' | 'contacts';

/**
 * Organizácie: the page header and the tabs Zákazníci, Partneri, Kontakty, each with how many
 * there are (D-1). The tab's own actions go in `children`.
 */
export function OrganizationsHeader({ active, children }: { active: Tab; children?: ReactNode }) {
  const customers = useQuery(trpc.customer.list.queryOptions({ role: 'customer', pageSize: 1 }));
  const partners = useQuery(trpc.customer.list.queryOptions({ role: 'partner', pageSize: 1 }));
  const persons = useQuery(trpc.person.list.queryOptions({ pageSize: 1 }));
  const tabs: { key: Tab; to: string; count: number | undefined }[] = [
    { key: 'customers', to: '/organizations/customers', count: customers.data?.total },
    { key: 'partners', to: '/organizations/partners', count: partners.data?.total },
    { key: 'contacts', to: '/organizations/contacts', count: persons.data?.counts.all },
  ];
  return (
    <>
      <PageHeader title={o.title} subtitle={o.subtitle}>
        {children}
      </PageHeader>
      <nav
        aria-label={o.title}
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
              {o.tabs[tab.key]}
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
