import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A status banner (ALMA-268, Figma W29): at the top of a screen, as wide as the content, rounded 12,
 * the icon in a 24 px soft circle, the text in body (a title in body strong), the action at the
 * right in the tone's text colour. Warning, danger, info (with a 4 px progress line when
 * something is running) and success; every banner here is state, so none has a ×. One banner at
 * a time on a screen: danger over warning over info over success.
 */
export type BannerTone = 'warning' | 'danger' | 'info' | 'success';

const LOOK: Record<
  BannerTone,
  { box: string; circle: string; text: string; action: string; progress: string; Icon: LucideIcon }
> = {
  warning: {
    box: 'bg-warning-soft',
    circle: 'bg-[#f6e2c3] text-[#8a4408]',
    text: 'text-[#8a4408]',
    action: 'text-[#8a4408]',
    progress: 'bg-warning',
    Icon: TriangleAlert,
  },
  danger: {
    box: 'bg-danger-soft',
    circle: 'bg-[#f6cfcf] text-[#8c1c20]',
    text: 'text-[#8c1c20]',
    action: 'text-[#8c1c20]',
    progress: 'bg-danger',
    Icon: CircleAlert,
  },
  info: {
    box: 'bg-info-soft',
    circle: 'bg-[#d6dfed] text-[#2e4a78]',
    text: 'text-[#2e4a78]',
    action: 'text-[#2e4a78]',
    progress: 'bg-info',
    Icon: Info,
  },
  success: {
    box: 'bg-success-soft',
    circle: 'bg-[#d4ecc9] text-[#2f6e25]',
    text: 'text-[#2f6e25]',
    action: 'text-[#2f6e25]',
    progress: 'bg-success',
    Icon: CircleCheck,
  },
};

export function StatusBanner({
  tone,
  title,
  children,
  icon,
  action,
  progress,
  role = 'status',
  className,
}: {
  tone: BannerTone;
  /** One line in body strong; `children` is the sentence under or beside it. */
  title?: ReactNode;
  children?: ReactNode;
  /** The tone's own icon unless the banner has a better one. */
  icon?: LucideIcon;
  /** The one action at the right: a `<button>` or `<Link>` already dressed, or plain text. */
  action?: ReactNode;
  /** 0–100: the 4 px line along the bottom of an info banner while something runs. */
  progress?: number | undefined;
  role?: 'status' | 'alert';
  className?: string | undefined;
}) {
  const look = LOOK[tone];
  const Icon = icon ?? look.Icon;
  return (
    <section
      role={role}
      className={cn(
        'relative flex min-h-12 items-center gap-3 overflow-hidden rounded-xl px-4 py-2.5',
        look.box,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full',
          look.circle,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className={cn('min-w-0 flex-1 text-[15px] leading-[21px]', look.text)}>
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn(title && 'text-[13px] leading-[18px]')}>{children}</div>
        ) : null}
      </div>
      {action ? (
        <div className={cn('shrink-0 text-[13px] font-medium [&_a]:hover:underline', look.action)}>
          {action}
        </div>
      ) : null}
      {progress !== undefined ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-black/5">
          <span
            className={cn('block h-full transition-[width] duration-300', look.progress)}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </span>
      ) : null}
    </section>
  );
}
