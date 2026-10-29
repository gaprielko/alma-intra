import { sk } from '@intra/shared/i18n';
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ location }) => {
    // The settings open on their first section.
    if (location.pathname.replace(/\/$/, '') === '/settings')
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
      throw redirect({ to: '/settings/users', replace: true });
  },
  component: SettingsLayout,
});

const tabClass =
  'relative inline-flex h-10 items-center px-1 text-sm font-medium text-muted transition-colors hover:text-foreground';
const activeTabClass =
  'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary';

/** Nastavenia: the header and the tabs of its sections. */
function SettingsLayout() {
  const t = sk.settings;
  return (
    <>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <nav aria-label={t.tabs.label} className="flex gap-6 border-b border-border px-7">
        <Link to="/settings/users" className={tabClass} activeProps={{ className: activeTabClass }}>
          {t.tabs.users}
        </Link>
        <Link
          to="/settings/code-lists"
          className={tabClass}
          activeProps={{ className: activeTabClass }}
        >
          {t.tabs.codeLists}
        </Link>
        <Link
          to="/settings/email-look"
          className={tabClass}
          activeProps={{ className: activeTabClass }}
        >
          {t.tabs.emailLook}
        </Link>
        <Link
          to="/settings/pricing"
          className={tabClass}
          activeProps={{ className: activeTabClass }}
        >
          {sk.products.vat.tab}
        </Link>
        <Link
          to="/settings/activity-log"
          className={tabClass}
          activeProps={{ className: activeTabClass }}
        >
          {t.tabs.activityLog}
        </Link>
      </nav>
      <Outlet />
    </>
  );
}
