import { sk } from '@intra/shared/i18n';
import { Link, type LinkProps } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { Tooltip } from '@/components/ui/tooltip';
import { toggleSidebar, useSidebarCollapsed } from '@/lib/sidebar-state';
import { cn } from '@/lib/utils';

/** The id the toggle's `aria-controls` points at. */
export const SIDEBAR_ID = 'app-sidebar';

/** The rail's tooltips wait 200 ms, a little less than the rest of the app's. */
const RAIL_TOOLTIP_DELAY = 200;

/**
 * An item of the navigation: 40 high, rounded 10, padding 10/12, the mark 20. Hovered, it takes
 * white at 8 %; active, a glow running out to the right with a 3 × 22 bar on its left edge, a
 * 1 px ring and a soft shadow. Folded, it is the mark alone, centred.
 */
function itemClass(collapsed: boolean) {
  return cn(
    'relative flex h-10 items-center rounded-[10px] transition-colors duration-150 ease-out-soft',
    collapsed ? 'mx-auto w-10 justify-center' : 'gap-3 px-3 text-[15px] font-medium',
  );
}

const idleClass = 'text-sidebar-text hover:bg-white/8 hover:text-sidebar-text-active';
const activeClass =
  'bg-(image:--sidebar-item) text-sidebar-text-active shadow-[inset_0_0_0_1px_rgba(95,208,201,0.28),0_4px_14px_rgba(0,0,0,0.18)] [&_svg]:text-sidebar-icon-active before:absolute before:top-1/2 before:left-0 before:h-[22px] before:w-[3px] before:-translate-y-1/2 before:rounded-r-[3px] before:bg-sidebar-icon-active';

/** The button that folds the sidebar to its icon rail and opens it again. */
export function SidebarToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  // One steady name and `aria-expanded` for the state; the tooltip says what a click does.
  const tooltip = collapsed ? sk.shell.expandMenu : sk.shell.collapseMenu;
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Tooltip text={tooltip} side="right" delay={RAIL_TOOLTIP_DELAY}>
      <button
        type="button"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-sidebar-text transition-colors duration-150 hover:bg-white/8 hover:text-sidebar-text-active"
        aria-expanded={!collapsed}
        aria-controls={SIDEBAR_ID}
        aria-label={sk.shell.menu}
        onClick={onToggle}
      >
        <Icon className="size-[18px]" aria-hidden />
      </button>
    </Tooltip>
  );
}

/**
 * The sidebar of the shell. It is as tall as the window and stays where it is while the page
 * scrolls: the brand on top, the navigation in the middle (the only part that scrolls inside it,
 * on a window too short for all of it), the footer (settings, the user, logout) always in view.
 * 232 px wide; folded, it is an icon rail 72 px wide.
 */
export function AppSidebar({
  title,
  subtitle,
  railTitle,
  nav,
  footer,
}: {
  title: ReactNode;
  subtitle: string;
  /** The name as a tooltip on the brand mark in the rail. */
  railTitle?: string | undefined;
  nav: (collapsed: boolean) => ReactNode;
  footer: (collapsed: boolean) => ReactNode;
}) {
  const collapsed = useSidebarCollapsed();
  return (
    <aside
      data-sidebar
      id={SIDEBAR_ID}
      data-collapsed={collapsed}
      className={cn(
        // Dark teal: the brand's colour carries the frame, the pages stay light.
        'sticky top-0 flex h-dvh flex-col bg-sidebar bg-(image:--sidebar-fill) shadow-[inset_-1px_0_0_rgba(255,255,255,0.05)] transition-[width] duration-150 ease-out-soft',
        collapsed ? 'w-[72px] px-4 py-4' : 'w-[232px] px-3.5 py-4',
      )}
    >
      <div
        className={cn(
          'shrink-0',
          collapsed ? 'flex flex-col items-center gap-2 py-1' : 'flex items-center gap-3 px-1 py-1',
        )}
      >
        <BrandMark
          title={collapsed ? railTitle : undefined}
          className="size-8 bg-linear-160 from-[#18a5a7] to-[#0b7375] shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_14px_rgba(95,208,201,0.25)]"
        />
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-[18px] font-semibold text-sidebar-text-active">
              {title}
            </p>
            <p className="truncate text-xs text-sidebar-text">{subtitle}</p>
          </div>
        )}
        <SidebarToggle collapsed={collapsed} onToggle={toggleSidebar} />
      </div>

      {/* Only this part scrolls when the window is shorter than the navigation. The padding is
          room for the focus ring, which `overflow` would otherwise cut off. */}
      <div className="mt-5 -mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">{nav(collapsed)}</div>

      <div className="shrink-0 pt-3">{footer(collapsed)}</div>
    </aside>
  );
}

type NavIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** In the rail the label is the tooltip; open, the words stand next to the mark. */
function RailTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!collapsed) return children;
  return (
    <Tooltip text={label} side="right" delay={RAIL_TOOLTIP_DELAY}>
      {children}
    </Tooltip>
  );
}

/** A navigation link. Folded, it is its mark; the label stays as tooltip and accessible name. */
export function SidebarLink({
  to,
  icon: Icon,
  label,
  collapsed,
}: {
  to: NonNullable<LinkProps['to']>;
  icon: NavIcon;
  label: string;
  collapsed: boolean;
}) {
  return (
    <RailTooltip collapsed={collapsed} label={label}>
      <Link
        to={to}
        className={itemClass(collapsed)}
        // The router joins these onto `className`, so the idle hover must not sit there.
        activeProps={{ className: activeClass }}
        inactiveProps={{ className: idleClass }}
        aria-label={collapsed ? label : undefined}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        {collapsed ? null : <span className="truncate">{label}</span>}
      </Link>
    </RailTooltip>
  );
}
