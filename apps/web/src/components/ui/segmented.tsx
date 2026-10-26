import { Link, type RegisteredRouter, type ValidateLinkOptions } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * A segmented control (ALMA-268, Figma W13): a track in `bg-track`, rounded 10 with 3 px of padding,
 * segments 32 high in 13 px medium, the chosen one white, rounded 8, on Elevation/1. The white
 * indicator slides to the chosen segment in 180 ms. For a choice between a few views (Týždeň /
 * Deň), never for a filter with many values. Each segment is a link, so the choice is a route.
 */
const trackClass =
  'relative inline-grid h-[38px] auto-cols-fr grid-flow-col rounded-[10px] bg-track p-[3px]';
const segmentClass =
  'relative z-10 inline-flex h-8 items-center justify-center rounded-lg px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const indicatorClass =
  'absolute inset-y-[3px] left-[3px] rounded-lg bg-white shadow-rest transition-transform duration-[180ms] ease-out-soft';

/** The white indicator, as wide as one segment, moved under the chosen one. */
function Indicator({ count, index }: { count: number; index: number }) {
  if (index < 0) return null;
  return (
    <span
      aria-hidden
      className={indicatorClass}
      style={{
        width: `calc((100% - 6px) / ${count})`,
        transform: `translateX(${index * 100}%)`,
      }}
    />
  );
}

/** Every segment is a page: the chosen one is the current route. */
export function SegmentedLinks<TRouter extends RegisteredRouter, TOptions>(props: {
  options: readonly {
    key: string;
    label: ReactNode;
    link: ValidateLinkOptions<TRouter, TOptions>;
  }[];
  current: string;
  label: string;
  className?: string | undefined;
}): ReactNode;
export function SegmentedLinks({
  options,
  current,
  label,
  className,
}: {
  options: readonly { key: string; label: ReactNode; link: ValidateLinkOptions }[];
  current: string;
  label: string;
  className?: string | undefined;
}) {
  const index = options.findIndex((option) => option.key === current);
  return (
    <nav aria-label={label} className={cn(trackClass, className)}>
      <Indicator count={options.length} index={index} />
      {options.map((option) => {
        const active = option.key === current;
        return (
          <Link
            key={option.key}
            {...option.link}
            aria-current={active ? 'page' : undefined}
            className={cn(
              segmentClass,
              active ? 'text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The same control for a choice that is not a route: a reading of the numbers on one page (per
 * day, or in total). Each segment is a toggle button, the chosen one pressed; the choice is not
 * in the address.
 */
export function SegmentedChoice<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { key: T; label: ReactNode }[];
  value: T;
  onChange: (key: T) => void;
  label: string;
  className?: string | undefined;
}) {
  const index = options.findIndex((option) => option.key === value);
  return (
    <div role="group" aria-label={label} className={cn(trackClass, className)}>
      <Indicator count={options.length} index={index} />
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.key)}
            className={cn(
              segmentClass,
              active ? 'text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * W13: the period stepper next to a segmented control: ‹ the period › and „Dnes“ after a line.
 * The arrows are 36 px icon buttons with tooltips; the period is read as text between them.
 */
export function PeriodStepper({
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  todayLabel,
  onToday,
  atToday = false,
  className,
}: {
  label: ReactNode;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  todayLabel?: string | undefined;
  onToday?: (() => void) | undefined;
  /**
   * The period shown is already today's (ALMA-288 item 45): „Dnes“ stays in its place, so
   * nothing jumps, but quiet and inactive.
   */
  atToday?: boolean;
  className?: string | undefined;
}) {
  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <Tooltip text={previousLabel}>
        <Button size="icon" aria-label={previousLabel} onClick={onPrevious}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
      </Tooltip>
      <span className="min-w-0 px-2 text-sm font-medium tabular-nums">{label}</span>
      <Tooltip text={nextLabel}>
        <Button size="icon" aria-label={nextLabel} onClick={onNext}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </Tooltip>
      {todayLabel && onToday ? (
        <>
          <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
          {atToday ? (
            <Button
              variant="ghost"
              size="sm"
              aria-disabled
              aria-current="date"
              className="cursor-default text-tertiary hover:bg-transparent active:scale-100"
            >
              {todayLabel}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onToday}>
              {todayLabel}
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}
