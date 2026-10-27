import { sk } from '@intra/shared/i18n';
import type { CustomerKind, CustomerStatus } from '@intra/shared/schemas';
import { ChevronDown, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import {
  DropdownMenu,
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
