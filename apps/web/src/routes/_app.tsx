import { sk } from '@intra/shared/i18n';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { AppSidebar, SidebarLink } from '@/components/app-sidebar';
import { UploadPanel } from '@/components/files/file-bits';
import { Avatar } from '@/components/avatar';
import { IdleWarning } from '@/components/idle-warning';
import { NotificationBell } from '@/components/notification-bell';
import {
  CustomersMark,
  EmailsMark,
  FilesMark,
  OverviewMark,
  SettingsMark,
} from '@/components/nav-marks';
import { RouteError } from '@/components/route-error';
import { RouteFade } from '@/components/route-fade';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { requireSession } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { useSignOut } from '@/lib/use-sign-out';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app')({
  beforeLoad: requireSession,
  component: AppShell,
  errorComponent: RouteError,
});

const nav = sk.shell.nav;

function AppShell() {
  const user = useSession((s) => s.user);
  const { signOut, idleWarning } = useSignOut();

  return (
    <div className="grid min-h-dvh grid-cols-[auto_minmax(0,1fr)]">
      <AppSidebar
        title={sk.brand.name}
        subtitle={sk.brand.subtitle}
        railTitle={sk.brand.name}
        nav={(collapsed) => (
          <nav aria-label={nav.label} className="space-y-1">
            <SidebarLink
              to="/overview"
              icon={OverviewMark}
              label={nav.overview}
              collapsed={collapsed}
            />
            <SidebarLink
              to="/organizations"
              icon={CustomersMark}
              label={nav.customers}
              collapsed={collapsed}
            />
            <SidebarLink to="/emails" icon={EmailsMark} label={nav.emails} collapsed={collapsed} />
            <SidebarLink to="/files" icon={FilesMark} label={nav.files} collapsed={collapsed} />
          </nav>
        )}
        footer={(collapsed) => (
          <div className="space-y-2">
            <NotificationBell collapsed={collapsed} />
            <SidebarLink
              to="/settings"
              icon={SettingsMark}
              label={nav.settings}
              collapsed={collapsed}
            />
            <div className="border-t border-white/8 pt-3">
              <UserCard
                name={user?.name ?? ''}
                position={user?.position ?? user?.email ?? ''}
                collapsed={collapsed}
                onSignOut={() => void signOut()}
              />
            </div>
          </div>
        )}
      />

      <div className="min-w-0">
        <RouteFade>
          <Outlet />
        </RouteFade>
      </div>
      {/* Uploads keep going while somebody moves on to another screen. */}
      <UploadPanel />
      <IdleWarning open={idleWarning} />
    </div>
  );
}

/**
 * The user at the bottom of the sidebar: the card opens Môj účet, the door beside it signs out,
 * asking first. Folded, the avatar alone, with the door under it.
 */
function UserCard({
  name,
  position,
  collapsed,
  onSignOut,
}: {
  name: string;
  position: string;
  collapsed: boolean;
  onSignOut: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const c = sk.auth.logoutConfirm;
  const card = (
    <Link
      to="/account"
      aria-label={collapsed ? `${nav.account} · ${name}` : undefined}
      className={cn(
        'flex min-w-0 items-center rounded-[10px] transition-colors duration-150 hover:bg-white/8',
        collapsed ? 'size-10 justify-center' : 'flex-1 gap-2.5 px-2 py-1.5',
      )}
      activeProps={{
        className: 'bg-(image:--sidebar-item) shadow-[inset_0_0_0_1px_rgba(95,208,201,0.28)]',
      }}
    >
      <Avatar name={name} size={32} />
      {collapsed ? null : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-4 font-semibold text-sidebar-text-active">
            {name}
          </span>
          <span className="block truncate text-[11px] leading-[14px] text-sidebar-text">
            {position}
          </span>
        </span>
      )}
    </Link>
  );
  return (
    <>
      <div className={cn('flex items-center', collapsed ? 'flex-col gap-2' : 'gap-1')}>
        {collapsed ? (
          <Tooltip text={`${nav.account} · ${name}`} side="right" delay={200}>
            {card}
          </Tooltip>
        ) : (
          card
        )}
        <Tooltip text={sk.auth.logout} side={collapsed ? 'right' : 'top'} delay={200}>
          <button
            type="button"
            aria-label={sk.auth.logout}
            onClick={() => setAsking(true)}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-sidebar-text transition-colors duration-150 hover:bg-white/8 hover:text-sidebar-text-active"
          >
            <LogOut className="size-[18px]" aria-hidden />
          </button>
        </Tooltip>
      </div>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={c.title}
        description={c.text}
        confirmLabel={c.confirm}
        onConfirm={() => {
          setAsking(false);
          onSignOut();
        }}
      />
    </>
  );
}
