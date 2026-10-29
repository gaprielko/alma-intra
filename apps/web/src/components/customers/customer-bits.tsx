import { sk } from '@intra/shared/i18n';
import type { CustomerKind, CustomerStatus } from '@intra/shared/schemas';
import { ChevronDown, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { avatarColorOf } from '@/lib/avatar-color';
import { nameInitials } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<CustomerStatus, BadgeTone> = {
  lead: 'neutral',
  contacted: 'info',
  interested: 'warning',
  customer: 'success',
  former_customer: 'neutral',
  not_interested: 'neutral',
};

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {sk.customers.status[status]}
    </Badge>
  );
}

/** Legal forms and joining words that say nothing about which company it is. */
const NOT_A_NAME =
  /^(s\.?r\.?o\.?|a\.?s\.?|n\.?o\.?|o\.?z\.?|spol\.?|k\.?s\.?|v\.?o\.?s\.?|z\.?s\.?|s|a|pri|pre|na|v)$/i;

/** „ADOS Harmónia, s.r.o.“ → „AH“: the first letters of the first two words that name it. */
export function organizationInitials(name: string): string {
  const words = name.split(/[\s,]+/).filter((word) => word && !NOT_A_NAME.test(word));
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/**
 * A customer's initials on the colour its name keeps: a rounded square for an organization, a
 * circle for a private person.
 */
export function CustomerAvatar({
  name,
  kind,
  size = 32,
}: {
  name: string;
  kind: CustomerKind;
  size?: 32 | 40 | 48;
}) {
  const color = avatarColorOf(name);
  return (
    <span
      aria-hidden
      style={{ background: color.bg, color: color.text }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold',
        size === 32 && 'size-8 text-[11px]',
        size === 40 && 'size-10 text-[13px]',
        size === 48 && 'size-12 text-[15px]',
        kind === 'individual' ? 'rounded-full' : 'rounded-[10px]',
      )}
    >
      {kind === 'individual' ? nameInitials(name) : organizationInitials(name)}
    </span>
  );
}

export function TagChip({
  children,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
}) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 text-xs font-medium whitespace-nowrap text-muted">
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="-mr-1 inline-flex size-4 items-center justify-center rounded text-tertiary hover:bg-hover hover:text-foreground"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

const filterClass =
  'inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border bg-white pr-2.5 pl-3 text-[13px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-hover';

/**
 * One filter of a list: „Kraj ▾“ while unset, „Kraj: Košický ×“ once set, where × clears it. The
 * options open in a menu.
 */
export function FilterMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | undefined) => void;
}) {
  const current = options.find((o) => o.value === value);
  if (current) {
    return (
      <span className={cn(filterClass, 'border-primary pr-1 font-semibold text-primary-text')}>
        <DropdownMenu>
          <DropdownMenuTrigger className="outline-none">
            {label}: {current.label}
          </DropdownMenuTrigger>
          <MenuItems options={options} value={value} onChange={onChange} />
        </DropdownMenu>
        <button
          type="button"
          aria-label={sk.customers.filters.clear(label)}
          onClick={() => onChange(undefined)}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-primary-soft"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={filterClass}>
        {label}
        <ChevronDown className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <MenuItems options={options} value={value} onChange={onChange} />
    </DropdownMenu>
  );
}

function MenuItems<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <DropdownMenuContent align="start" className="max-h-80 min-w-48 overflow-y-auto">
      {options.map((option) => (
        <DropdownMenuItem
          key={option.value}
          onSelect={() => onChange(option.value)}
          className={cn(option.value === value && 'font-semibold')}
        >
          {option.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

/**
 * A dropdown filter of several values (D-12): ticking keeps the menu open, the button names what
 * is picked („Stav: Oslovený, Má záujem“, or how many), the cross clears it.
 */
export function MultiFilterMenu<T extends string>({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: readonly T[] | undefined;
  options: readonly { value: T; label: string; count?: number | undefined }[];
  onChange: (values: T[] | undefined) => void;
}) {
  const picked = options.filter((o) => values?.includes(o.value));
  const toggle = (value: T) => {
    const next = values?.includes(value)
      ? values.filter((v) => v !== value)
      : [...(values ?? []), value];
    onChange(next.length > 0 ? next : undefined);
  };
  const items = (
    <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.value}
          checked={values?.includes(option.value) ?? false}
          // Several values are picked in one go: the menu stays open.
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={() => toggle(option.value)}
        >
          <span className="flex-1">{option.label}</span>
          {option.count === undefined ? null : (
            <span className="text-xs text-muted tabular-nums">{option.count}</span>
          )}
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuContent>
  );
  const on = picked.length > 0;
  // One menu whatever is picked: swapping it for another would close it after the first tick.
  return (
    <span
      className={cn(
        filterClass,
        on ? 'border-primary pr-1 font-semibold text-primary-text' : 'p-0',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn('inline-flex items-center gap-1.5 outline-none', !on && 'h-full px-3')}
        >
          {on ? `${label}: ${sk.organizations.picked(picked.map((o) => o.label))}` : label}
          {on ? null : <ChevronDown className="size-3.5" aria-hidden />}
        </DropdownMenuTrigger>
        {items}
      </DropdownMenu>
      {on ? (
        <button
          type="button"
          aria-label={sk.customers.filters.clear(label)}
          onClick={() => onChange(undefined)}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-primary-soft"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** A product of a record (ADOS, DOS, …), in the accent so it stands apart from the grey tags. */
export function ProductChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center rounded-md bg-primary-soft px-2 text-xs font-semibold whitespace-nowrap text-primary-text">
      {children}
    </span>
  );
}
