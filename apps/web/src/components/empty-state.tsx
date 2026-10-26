import { sk } from '@intra/shared/i18n';
import {
  BellOff,
  CalendarDays,
  CircleAlert,
  CloudOff,
  Heart,
  Inbox,
  Search,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * ALMA-268 (Figma W10): a screen or a card with nothing to show says so with the illustration of
 * the phone's set (ALMA-259 „DU-08", ALMA-260 I1) at 96 px, a headline, one sentence and at most
 * one secondary action. `ErrorState` is the same shape in danger with „Skúsiť znova“.
 *
 * The illustration: a soft disc, a white circle with one glyph on it, two small dots beside it
 * that drift a little, as on the phone. Decorative, hidden from screen readers. It comes in once
 * (700 ms) and the dots breathe very slowly after; nothing moves for a user who asked for less
 * motion (ALMA-288 item 33). Every empty and error state of the web is this one component.
 */
export type IllustrationKind =
  'empty' | 'nobodyFound' | 'done' | 'noNotifications' | 'offline' | 'welcome' | 'error';

interface Look {
  Icon: LucideIcon;
  disc: string;
  glyph: string;
  dots: [string, string];
}

const TEAL = '#5FD0C9';
const AMBER = '#FAC775';
const RED = '#F09595';

const teal = (Icon: LucideIcon, dots: [string, string] = [TEAL, TEAL]): Look => ({
  Icon,
  disc: 'var(--color-primary-soft)',
  glyph: 'var(--color-primary)',
  dots,
});

const LOOK: Record<IllustrationKind, Look> = {
  empty: teal(CalendarDays, [TEAL, AMBER]),
  nobodyFound: teal(Search, [TEAL, AMBER]),
  done: teal(Inbox),
  noNotifications: teal(BellOff, [TEAL, AMBER]),
  welcome: teal(Heart, [TEAL, AMBER]),
  offline: {
    Icon: CloudOff,
    disc: 'var(--color-warning-soft)',
    glyph: 'var(--color-warning)',
    dots: [AMBER, AMBER],
  },
  error: {
    Icon: CircleAlert,
    disc: 'var(--color-danger-soft)',
    glyph: 'var(--color-danger)',
    dots: [RED, RED],
  },
};

export function Illustration({
  kind,
  size = 96,
  className,
}: {
  kind: IllustrationKind;
  size?: number;
  className?: string | undefined;
}) {
  const { Icon, disc, glyph, dots } = LOOK[kind];
  const inner = Math.round(size * 0.54);
  const dot = Math.round(size * 0.07);
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-block shrink-0 motion-safe:animate-illustration-in',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 flex items-center justify-center rounded-full"
        style={{ backgroundColor: disc }}
      >
        <span
          className="flex items-center justify-center rounded-full bg-white shadow-raised"
          style={{ width: inner, height: inner, color: glyph }}
        >
          <Icon style={{ width: inner * 0.46, height: inner * 0.46 }} strokeWidth={1.75} />
        </span>
      </span>
      <span
        className="absolute rounded-full motion-safe:animate-[drift_6s_ease-in-out_infinite_alternate]"
        style={{ width: dot, height: dot, top: 1, right: -3, backgroundColor: dots[0] }}
      />
      <span
        className="absolute rounded-full motion-safe:animate-[drift_6s_ease-in-out_2s_infinite_alternate]"
        style={{ width: dot, height: dot, bottom: 12, left: -7, backgroundColor: dots[1] }}
      />
    </span>
  );
}

export function EmptyState({
  kind = 'empty',
  title,
  text,
  action,
  compact = false,
  className,
  role,
}: {
  kind?: IllustrationKind;
  /** `alert` for an error state, so a screen reader says it at once. */
  role?: 'alert' | undefined;
  title: string;
  /** One sentence; leave it out when the title says it all. */
  text?: string | undefined;
  /** One secondary action, already a `Button` or a link in its clothes. */
  action?: ReactNode;
  /** Inside a card that has more under it: a smaller disc and less air. */
  compact?: boolean;
  className?: string | undefined;
}) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'gap-3 px-6 py-8' : 'gap-4 px-6 py-14',
        className,
      )}
    >
      <Illustration kind={kind} size={compact ? 72 : 96} />
      <div className="flex flex-col gap-1">
        <p className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em]">{title}</p>
        {text ? <p className="max-w-sm text-[13px] leading-[18px] text-muted">{text}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** The same shape for something that did not load, with the one way out: trying again. */
export function ErrorState({
  title = sk.errors.pageTitle,
  text,
  onRetry,
  compact = false,
  className,
}: {
  title?: string;
  text?: string | undefined;
  onRetry?: (() => void) | undefined;
  compact?: boolean;
  className?: string | undefined;
}) {
  return (
    <EmptyState
      role="alert"
      kind="error"
      title={title}
      text={text}
      compact={compact}
      className={className}
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            {sk.errors.retry}
          </Button>
        ) : undefined
      }
    />
  );
}
