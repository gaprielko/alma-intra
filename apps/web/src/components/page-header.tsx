import { sk } from '@intra/shared/i18n';
import {
  Link,
  useLocation,
  useRouter,
  type RegisteredRouter,
  type ValidateLinkOptions,
} from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { forgetAfter, nameLocation, titleOf, usePreviousLocation } from '@/lib/previous-location';
import { cn } from '@/lib/utils';

/**
 * Where „‹ …“ at the bottom of the header leads: any link a `<Link>` takes, and the label that names the
 * destination („Zákazníci“), not the act of going back.
 */
export type PageHeaderBack<
  TRouter extends RegisteredRouter = RegisteredRouter,
  TOptions = unknown,
> = ValidateLinkOptions<TRouter, TOptions> & { label: string };

interface PageHeaderProps<TRouter extends RegisteredRouter, TOptions> {
  title: string;
  subtitle?: ReactNode | undefined;
  back?: PageHeaderBack<TRouter, TOptions>;
  badge?: ReactNode;
  /** Facts at the right end of the back row („Prevádzky: 5“). */
  backAside?: ReactNode;
  children?: ReactNode;
}

const SCROLLED_AT = 8;

/** Whether the window has scrolled past `threshold`; the header then lifts off the page. */
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

/** W2: the breadcrumb, 12 px medium in tertiary. */
const BACK_CLASS =
  'inline-flex max-w-full items-center gap-0.5 text-xs font-medium text-tertiary transition-colors hover:text-primary-text';

/**
 * The way back, at the very bottom left of the header. The breadcrumb leads to the screen's own
 * list; when the user came from somewhere else (a product opened from a customer), „‹ Späť na …“
 * after it returns there, named by that screen's title.
 */
function BackRow({ back, aside }: { back: PageHeaderBack; aside?: ReactNode }) {
  const router = useRouter();
  const { pathname } = useLocation();
  const previous = usePreviousLocation(pathname);
  const target = router.buildLocation(back as Parameters<typeof router.buildLocation>[0]).pathname;
  const elsewhere = previous && previous.pathname !== target ? previous : null;
  return (
    <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-6 gap-y-1">
      <Link {...(back as ValidateLinkOptions)} className={BACK_CLASS}>
        <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{back.label}</span>
      </Link>
      {elsewhere ? (
        <button
          type="button"
          className={BACK_CLASS}
          onClick={() => {
            forgetAfter(elsewhere);
            void router.navigate({ href: elsewhere.href });
          }}
        >
          <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {titleOf(elsewhere.pathname)
              ? sk.common.backTo(titleOf(elsewhere.pathname)!)
              : sk.common.back}
          </span>
        </button>
      ) : null}
      {aside ? (
        <div className="ml-auto flex flex-wrap items-center gap-x-3.5 text-xs text-muted">
          {aside}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The sticky header of every screen: title (never cut), its badge and subtitle on the left, the
 * screen's tools on the right, and the back link at the bottom left. It wraps: the tools move under the title only when they
 * do not fit beside it.
 */
export function PageHeader<TRouter extends RegisteredRouter, TOptions>(
  props: PageHeaderProps<TRouter, TOptions>,
): ReactNode;
export function PageHeader({
  title,
  subtitle,
  back,
  badge,
  backAside,
  children,
}: PageHeaderProps<RegisteredRouter, unknown>) {
  const scrolled = useScrolled();
  const { pathname } = useLocation();
  useEffect(() => nameLocation(pathname, title), [pathname, title]);
  // How tall the header is right now, for what sticks under it: it wraps and may have a back row.
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty('--page-header-height', `${element.offsetHeight}px`),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <header
      ref={header}
      className={cn(
        'sticky top-0 z-30 flex min-h-[72px] flex-wrap items-center gap-x-4 gap-y-2 border-b bg-white/80 px-7 py-3 backdrop-blur-lg backdrop-saturate-150 transition-[box-shadow,border-color] duration-150',
        scrolled ? 'border-border shadow-header' : 'border-transparent',
      )}
    >
      <div className="max-w-full min-w-0 flex-[1_1_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-[22px] leading-7 font-bold tracking-[-0.01em] break-words">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle ? (
          <div className="text-[13px] leading-[18px] text-balance text-muted [contain:inline-size]">
            {subtitle}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="ml-auto flex flex-[1_1_0] flex-wrap items-center justify-end gap-3">
          {children}
        </div>
      ) : null}
      {back ? <BackRow back={back} aside={backAside} /> : null}
    </header>
  );
}
