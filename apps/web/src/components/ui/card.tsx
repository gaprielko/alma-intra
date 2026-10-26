import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A card (ALMA-268, Figma W9): surface white on the canvas, Elevation/1 at rest, corners 16, the
 * subtle border only. `interactive` lifts it under the pointer (Elevation/2, 2 px up); `edge`
 * gives the main action card its 1 px light edge on top.
 */
export function Card({
  className,
  interactive = false,
  edge = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean; edge?: boolean }) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-border-subtle bg-white shadow-rest',
        interactive &&
          'transition-[box-shadow,transform] duration-150 ease-out-soft hover:-translate-y-0.5 hover:shadow-raised motion-reduce:hover:translate-y-0',
        edge && 'shadow-edge-rest',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 px-5 pt-5">
      <h2 className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
      {action}
    </header>
  );
}

/** Label above value, as used throughout the patient card. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
