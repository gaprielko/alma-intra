import { sk } from '@intra/shared/i18n';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { formatDateText, isoOfDate, parseDateText } from '@/lib/field-input';
import { cn } from '@/lib/utils';

const t = sk.common.datePicker;

type View = 'days' | 'months' | 'years';

const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y: y!, m: m! - 1, d: d! };
};

/**
 * A date field of the whole app (D-40): a click anywhere in it opens the calendar, the year moves
 * directly by its own arrows, and a date can also be typed (`29.10.2026`, `29.10.26`). The form gets
 * `YYYY-MM-DD`, or `''` when empty; a date that is not one, or outside `min`–`max`, is not passed on
 * and the field says so.
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  clearable = true,
  inline = false,
  label,
  className,
}: {
  id?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  /** „Vymazať“: only where the date may be left out. */
  clearable?: boolean;
  /** Without a frame of its own: inside a filter's label. */
  inline?: boolean;
  label?: string | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(formatDateText(value));
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // A value set from outside (a template, a reset) shows; what is being typed stays.
  useEffect(() => {
    if (parseDateText(input.current?.value ?? '') !== value) setText(formatDateText(value));
    setError(null);
  }, [value]);

  const outside = (iso: string) => Boolean((min && iso < min) || (max && iso > max));
  const commit = () => {
    const typed = text.trim();
    if (!typed) {
      if (clearable) {
        onChange('');
        setError(null);
      } else {
        setText(formatDateText(value));
      }
      return;
    }
    const iso = parseDateText(typed);
    if (!iso) return setError(t.invalid);
    if (outside(iso)) return setError(t.outOfRange);
    setError(null);
    setText(formatDateText(iso));
    if (iso !== value) onChange(iso);
  };
  const pick = (iso: string) => {
    setText(formatDateText(iso));
    setError(null);
    onChange(iso);
    setOpen(false);
    input.current?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={field}
          className={cn(
            'inline-flex cursor-text items-center gap-2',
            inline
              ? 'h-7'
              : 'h-10 w-full rounded-[10px] border bg-white px-3 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
            !inline && (error ? 'border-danger' : 'border-border'),
            className,
          )}
          onClick={() => {
            input.current?.focus();
            setOpen(true);
          }}
        >
          <input
            ref={input}
            id={id}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            inputMode="numeric"
            placeholder={t.placeholder}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            onFocus={() => setOpen(true)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
                setOpen(false);
              } else if (event.key === 'Tab') {
                setOpen(false);
              }
            }}
            className={cn(
              'min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-tertiary',
              inline && 'w-[5.5rem] flex-none',
            )}
          />
          <Calendar
            className={cn('size-4 shrink-0', error ? 'text-danger' : 'text-primary-text')}
            aria-hidden
          />
        </div>
      </PopoverAnchor>
      {error && !inline ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <PopoverContent
        className="w-[19.75rem] p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // A click into the field keeps the calendar open, as a click anywhere in it opens it.
          if (field.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <Calendar3
          key={open ? 'open' : 'closed'}
          selected={parseDateText(text) ?? (value || null)}
          min={min}
          max={max}
          onPick={pick}
          onClear={
            clearable
              ? () => {
                  setText('');
                  setError(null);
                  onChange('');
                  setOpen(false);
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}

const CONTROL =
  'inline-flex h-[30px] items-center justify-center rounded-lg text-sm font-semibold hover:bg-primary-soft hover:text-primary-text';

function Arrow({ dir, label, onClick }: { dir: -1 | 1; label: string; onClick: () => void }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(CONTROL, 'w-[26px] text-primary-text')}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

/** The panel: the days of a month, with the month and the year each on their own arrows. */
function Calendar3({
  selected,
  min,
  max,
  onPick,
  onClear,
}: {
  selected: string | null;
  min?: string | undefined;
  max?: string | undefined;
  onPick: (iso: string) => void;
  onClear?: (() => void) | undefined;
}) {
  const today = isoOfDate(new Date());
  const start = parts(selected ?? today);
  const [view, setView] = useState<View>('days');
  const [year, setYear] = useState(start.y);
  const [month, setMonth] = useState(start.m);
  const [cursor, setCursor] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const a = t.arrows;

  const moveMonth = (by: number) => {
    const next = new Date(year, month + by, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };
  const allowed = (iso: string) => !((min && iso < min) || (max && iso > max));

  useEffect(() => {
    if (cursor) grid.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus();
  }, [cursor]);

  // Arrows go by the day and the week, into the next month when needed.
  const onDayKey = (event: KeyboardEvent, iso: string) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!by) return;
    event.preventDefault();
    const { y, m, d } = parts(iso);
    const next = new Date(y, m, d + by);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setCursor(isoOfDate(next));
  };

  const first = new Date(year, month, 1);
  const shift = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - shift + i));
  const rangeStart = year - ((((year - 2016) % 12) + 12) % 12);
  const yearControl = (
    <span className="inline-flex items-center rounded-[10px] bg-surface p-0.5">
      <Arrow dir={-1} label={a.previousYear} onClick={() => setYear(year - 1)} />
      <button
        type="button"
        aria-label={a.pickYear}
        onClick={() => setView('years')}
        className={cn(CONTROL, 'min-w-12 px-1.5 tabular-nums')}
      >
        {year}
      </button>
      <Arrow dir={1} label={a.nextYear} onClick={() => setYear(year + 1)} />
    </span>
  );

  return (
    <div>
      {view === 'days' ? (
        <>
          <div className="mb-2.5 flex justify-between gap-1.5">
            <span className="inline-flex items-center rounded-[10px] bg-surface p-0.5">
              <Arrow dir={-1} label={a.previousMonth} onClick={() => moveMonth(-1)} />
              <button
                type="button"
                aria-label={a.pickMonth}
                onClick={() => setView('months')}
                className={cn(CONTROL, 'min-w-[5.25rem] px-1.5')}
              >
                {t.months[month]}
              </button>
              <Arrow dir={1} label={a.nextMonth} onClick={() => moveMonth(1)} />
            </span>
            {yearControl}
          </div>
          <div className="mb-0.5 grid grid-cols-7">
            {t.weekdays.map((day) => (
              <span
                key={day}
                className="flex h-[26px] items-center justify-center text-[11px] font-semibold text-tertiary"
              >
                {day}
              </span>
            ))}
          </div>
          <div ref={grid} role="grid" className="grid grid-cols-7 gap-0.5">
            {days.map((date) => {
              const iso = isoOfDate(date);
              const enabled = allowed(iso);
              const isSelected = iso === selected;
              return (
                <button
                  key={iso}
                  type="button"
                  data-day={iso}
                  disabled={!enabled}
                  aria-pressed={isSelected}
                  tabIndex={iso === (cursor ?? selected ?? today) ? 0 : -1}
                  onClick={() => onPick(iso)}
                  onKeyDown={(event) => onDayKey(event, iso)}
                  className={cn(
                    'h-9 rounded-[10px] text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    !enabled && 'cursor-default text-border',
                    enabled && 'hover:bg-primary-soft',
                    enabled && date.getMonth() !== month && 'text-tertiary',
                    iso === today &&
                      !isSelected &&
                      'font-semibold ring-[1.5px] ring-primary ring-inset',
                    isSelected && 'bg-primary font-semibold text-white hover:bg-primary',
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {view === 'months' ? (
        <>
          <div className="mb-2.5 flex justify-center">{yearControl}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {t.monthsShort.map((name, index) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setMonth(index);
                  setView('days');
                }}
                className={cn(
                  'h-11 rounded-[10px] text-sm font-medium hover:bg-primary-soft',
                  index === month && 'bg-primary font-semibold text-white hover:bg-primary',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {view === 'years' ? (
        <>
          <div className="mb-2.5 flex justify-center">
            <span className="inline-flex items-center rounded-[10px] bg-surface p-0.5">
              <Arrow dir={-1} label={a.earlierYears} onClick={() => setYear(year - 12)} />
              <span className="min-w-[5.5rem] text-center text-sm font-semibold tabular-nums">
                {rangeStart}–{rangeStart + 11}
              </span>
              <Arrow dir={1} label={a.laterYears} onClick={() => setYear(year + 12)} />
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 12 }, (_, i) => rangeStart + i).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setYear(value);
                  setView('days');
                }}
                className={cn(
                  'h-11 rounded-[10px] text-sm font-medium tabular-nums hover:bg-primary-soft',
                  value === year && 'bg-primary font-semibold text-white hover:bg-primary',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="mt-2.5 flex items-center justify-between border-t border-border-subtle pt-2.5">
        <button
          type="button"
          disabled={!allowed(today)}
          onClick={() => onPick(today)}
          className="h-[30px] rounded-lg bg-primary-soft px-3 text-[13px] font-semibold text-primary-text disabled:opacity-50"
        >
          {sk.common.today}
        </button>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="h-[30px] rounded-lg px-2 text-[13px] font-semibold text-muted hover:text-foreground"
          >
            {t.clear}
          </button>
        ) : null}
      </div>
    </div>
  );
}
