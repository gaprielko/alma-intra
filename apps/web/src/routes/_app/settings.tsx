import { sk } from '@intra/shared/i18n';
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ location }) => {
    // The settings open on their first section.
    if (location.pathname.replace(/\/$/, '') === '/settings')
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
      throw redirect({ to: '/settings/company', replace: true });
  },
  component: SettingsLayout,
});

// The same tabs as Organizácie, Produkty and E-maily.
const tabClass =
  '-mb-px inline-flex h-[46px] items-center gap-2 border-b-2 px-3.5 text-sm font-semibold whitespace-nowrap';
const activeTabClass = 'border-primary text-primary-text';
const inactive = { className: 'border-transparent text-muted hover:text-foreground' };

/** Nastavenia: the header and the tabs of its sections. */
function SettingsLayout() {
  const t = sk.settings;
  const tabs = [
    { to: '/settings/company', label: t.tabs.company },
    { to: '/settings/users', label: t.tabs.users },
    { to: '/settings/code-lists', label: t.tabs.codeLists },
    { to: '/settings/email-look', label: t.tabs.emailLook },
    { to: '/settings/pricing', label: sk.products.vat.tab },
    { to: '/settings/activity-log', label: t.tabs.activityLog },
  ] as const;
  return (
    <>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <nav
        aria-label={t.tabs.label}
        className="flex gap-1 overflow-x-auto border-b border-border bg-white/80 px-7"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={tabClass}
            activeProps={{ className: activeTabClass }}
            inactiveProps={inactive}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
