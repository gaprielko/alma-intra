import {
  Link,
  type RegisteredRouter,
  useRouter,
  type ValidateLinkOptions,
} from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorState } from '@/components/empty-state';
import { GlobalSearchTrigger } from '@/components/global-search';
import { NotificationBell } from '@/components/notification-bell';
import { SyncChip } from '@/components/sync-chip';
import { useBackTarget, useNameTrailPage } from '@/lib/back-trail';
import { cn } from '@/lib/utils';

/**
 * Where „‹ …“ above the title leads: any link a `<Link>` takes, and the label that names the
 * destination („ADOS organizácie“, „Pacienti“, the organization's name), not the act of going back.
 */
export type PageHeaderBack<
  TRouter extends RegisteredRouter = RegisteredRouter,
  TOptions = unknown,
> = ValidateLinkOptions<TRouter, TOptions> & { label: string };

interface PageHeaderProps<TRouter extends RegisteredRouter, TOptions> {
  title: string;
  /** A line under the title; Dnes passes its clickable summary (ALMA-269, D1). */
  subtitle?: ReactNode | undefined;
  /** A detail or edit screen's way back, above the title on the left (ALMA-170). */
  back?: PageHeaderBack<TRouter, TOptions>;
  /** A status badge next to the title (the patient's state, the organization's). */
  badge?: ReactNode;
  /** The screen's actions, on the right after the search. Nothing that navigates back. */
  children?: ReactNode;
  /**
   * ALMA-361: how a back link elsewhere names this screen when it leads here, when the title is
   * too long for it („Dnes“ rather than „Dnes, utorok 20. októbra“). The title otherwise.
   */
  backName?: string;
}

/** W2: past 8 px of scrolling the header grows its bottom line and a shadow. */
const SCROLLED_AT = 8;

/** Whether the window has scrolled past the point where the header casts a shadow. */
export function useScrolled(threshold = SCROLLED_AT): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > threshold);
    read();
    window.addEventListener('scroll', read, { passive: true });
    return () => window.removeEventListener('scroll', read);
  }, [threshold]);
  return scrolled;
}

/**
 * The top bar of a screen (ALMA-268, Figma W2): sticky, 72 px, the title in 22 px bold with the
 * subtitle under it, the ⌘K search field (ALMA-104), the admin's bell (ALMA-107) and the screen's
 * actions — the same on every screen, lists included (a list's own filter lives in its filter
 * row). The bell and the sync chip sit before the actions, so they stay in one place whatever a
 * screen puts there.
 * Once the page has scrolled, the bar takes a bottom line and a shadow, so it reads as a layer.
 * It is frosted glass (ALMA-353): what scrolls under it shows through, blurred.
 */
export function PageHeader<TRouter extends RegisteredRouter, TOptions>(
  props: PageHeaderProps<TRouter, TOptions>,
): ReactNode;
export function PageHeader({
  title,
  subtitle,
  back,
  badge,
  children,
  backName,
}: PageHeaderProps<RegisteredRouter, unknown>) {
  const scrolled = useScrolled();
  useNameTrailPage(backName ?? title);
  return (
    // On paper the sheet carries its own header, with the agency and the period (ALMA-117).
    <header
      data-print="hide"
      className={cn(
        // A container, so the sync chip can fold to its dot when the bar is narrow (ALMA-285
        // item 12). The bar wraps: the title keeps its whole line and the tools move under it
        // only once the search has shrunk to its narrowest and they still do not fit.
        '@container/header sticky top-0 z-30 flex min-h-[72px] flex-wrap items-center gap-x-4 gap-y-2 border-b bg-white/80 px-7 py-3 backdrop-blur-lg backdrop-saturate-150 transition-[box-shadow,border-color] duration-150',
        scrolled ? 'border-border shadow-header' : 'border-transparent',
      )}
    >
      <div className="max-w-full min-w-0 flex-[1_1_auto]">
        {back ? <BackLink back={back} /> : null}
        <div className="flex min-w-0 items-center gap-3">
          {/* Never cut (ALMA-285 item 12): on a line of its own it may wrap, never truncate. */}
          <h1 className="text-[22px] leading-7 font-bold tracking-[-0.01em] break-words">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle ? (
          // `contain: inline-size` keeps the subtitle from widening the title block: it wraps
          // under the title (balanced, so no word is left alone on the second line) instead of
          // pushing the tools away.
          <div className="text-[13px] leading-[18px] text-balance text-muted [contain:inline-size]">
            {subtitle}
          </div>
        ) : null}
      </div>
      {/*
        Basis 0 with the automatic minimum (its min-content width, the search at its narrowest):
        that width is what counts when the bar decides to wrap, so tools that do not fit beside
        the title move under it instead of covering it. No `min-w-0` here.
      */}
      <div className="ml-auto flex flex-[1_1_0] items-center justify-end gap-3">
        <GlobalSearchTrigger />
        <NotificationBell />
        {/* The sync chip after the bell on every screen (ALMA-269 D1, shared element). */}
        <SyncChip />
        {children}
      </div>
    </header>
  );
}

/** W2: the breadcrumb, 12 px medium in tertiary, the current place in accent/text. */
const BACK_CLASS =
  'mb-0.5 inline-flex max-w-full items-center gap-0.5 text-xs font-medium text-tertiary transition-colors hover:text-primary-text';

/**
 * „‹ …“: back the way she came (ALMA-361), to that page's exact address and under its name; the
 * screen's own parent when this tab came from nowhere else (a new tab, the sidebar).
 */
function BackLink({ back: { label, ...link } }: { back: PageHeaderBack }) {
  const router = useRouter();
  const target = useBackTarget();
  // A page that never named itself, or further back than the browser keeps: the fixed parent
  // (review of #499).
  if (target?.label && target.steps < router.history.length) {
    return (
      <a
        href={target.href}
        className={BACK_CLASS}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          router.history.go(-target.steps);
        }}
      >
        <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{target.label}</span>
      </a>
    );
  }
  return (
    <Link {...(link as ValidateLinkOptions)} className={BACK_CLASS}>
      <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

interface PageErrorProps<TRouter extends RegisteredRouter, TOptions> {
  title: string;
  back: PageHeaderBack<TRouter, TOptions>;
  message: string;
  /** `info` when nothing failed and there is just nothing to show here (no run open). */
  tone?: 'error' | 'info';
  /** A way on besides back („Otvoriť pacienta“). */
  children?: ReactNode;
}

/**
 * A screen that cannot be shown (not found, refused, failed, or with nothing to show): the same
 * header and the same way back as when it can, and the reason below it (ALMA-251 item 6). No
 * screen draws its own back link.
 */
export function PageError<TRouter extends RegisteredRouter, TOptions>(
  props: PageErrorProps<TRouter, TOptions>,
): ReactNode;
export function PageError({
  title,
  back,
  message,
  tone = 'error',
  children,
}: PageErrorProps<RegisteredRouter, unknown>) {
  return (
    <div className="min-w-0">
      <PageHeader title={title} back={back} />
      {tone === 'error' ? (
        <div className="p-7">
          <ErrorState title={message} />
          {children ? <div className="-mt-8 text-center text-sm">{children}</div> : null}
        </div>
      ) : (
        <div className="space-y-3 p-7 text-sm">
          <p>{message}</p>
          {children}
        </div>
      )}
    </div>
  );
}
