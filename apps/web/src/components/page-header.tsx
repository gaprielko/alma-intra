import { sk } from '@intra/shared/i18n';
import {
  Link,
  useLocation,
  useRouter,
  type RegisteredRouter,
  type ValidateLinkOptions,
} from '@tanstack/react-router';
import { ArrowLeft, ChevronLeft } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { forgetAfter, usePreviousLocation } from '@/lib/previous-location';
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

/** „Späť“: a small framed button, so it reads apart from the breadcrumb beside it. */
const RETURN_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/25 bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-text transition-colors hover:bg-[#d6ebe9]';

/**
 * The way back, at the very bottom left of the header. The breadcrumb leads to the screen's own
 * list; when the user came from somewhere else (a product opened from a customer), „Späť“ before
 * it returns there.
 */
function BackRow({ back }: { back: PageHeaderBack }) {
  const router = useRouter();
  const { pathname } = useLocation();
  const previous = usePreviousLocation(pathname);
  const target = router.buildLocation(back as Parameters<typeof router.buildLocation>[0]).pathname;
  const elsewhere = previous && previous.pathname !== target ? previous : null;
  return (
    <div className="flex basis-full items-center gap-3">
      {elsewhere ? (
        <button
          type="button"
          className={RETURN_CLASS}
          onClick={() => {
            forgetAfter(elsewhere);
            void router.navigate({ href: elsewhere.href });
          }}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {sk.common.back}
        </button>
      ) : null}
      <Link {...(back as ValidateLinkOptions)} className={BACK_CLASS}>
        <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{back.label}</span>
      </Link>
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
  children,
}: PageHeaderProps<RegisteredRouter, unknown>) {
  const scrolled = useScrolled();
  return (
    <header
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
      {back ? <BackRow back={back} /> : null}
    </header>
  );
}
