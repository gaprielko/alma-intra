import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * A grey placeholder in the shape of content that has not arrived yet:
 * #E9EFEE, rounded 6, a lighter band shimmering over it every 1.4 s, and it appears only after
 * 200 ms so that a fast answer never flashes grey first. The shimmer stops for a user who asked the
 * system for less motion (the pulse class stays as the name the tests know). Size it with classes
 * (`h-4 w-32`); it is hidden from screen readers, the surrounding `LoadingRegion` says „Načítavam…“
 * once.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      className={cn(
        'block h-4 animate-pulse rounded-md bg-track motion-reduce:animate-none',
        'motion-safe:animate-[shimmer_1.4s_linear_infinite,fade-in_150ms_ease-out_200ms_both] motion-safe:bg-[linear-gradient(90deg,#e9efee_0%,#e9efee_40%,#f4f8f7_50%,#e9efee_60%,#e9efee_100%)] motion-safe:bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
