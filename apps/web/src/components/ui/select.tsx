import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { FocusEventHandler, ReactNode, Ref } from 'react';
import { inputClass } from '@/components/ui/input';
import { fromSelectItem, toSelectItem } from '@/lib/field-input';
import { cn } from '@/lib/utils';

export type SelectProps = {
  /** The chosen item's value; `''` is a real choice too (`<SelectItem value="">Bez lekára</SelectItem>`). */
  value: string | null | undefined;
  /** Called with the picked item's value. */
  onChange: (value: string) => void;
  /** `SelectItem`s (in any fragments or `.map`s). */
  children: ReactNode;
  /** Shown while `value` is `''`; leave it out when an item stands for `''`. */
  placeholder?: string | undefined;
  /** Styles the field (margins, width, `h-10 text-sm` for a compact one). */
  className?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  'aria-label'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
  onBlur?: FocusEventHandler<HTMLButtonElement> | undefined;
  onFocus?: FocusEventHandler<HTMLButtonElement> | undefined;
  /** Lands on the field's button, so React Hook Form can focus it on an error. */
  ref?: Ref<HTMLButtonElement> | undefined;
};

/**
 * Our own select instead of the browser's list, on Radix Select: a field in
 * the `Input` style and a list with hover, keyboard, typeahead and a tick on the chosen item.
 *
 * ```tsx
 * <Label htmlFor="absence-type">Typ</Label>
 * <Select id="absence-type" value={type} onChange={setType}>
 *   <SelectItem value="vacation">Dovolenka</SelectItem>
 *   <SelectItem value="">Bez typu</SelectItem>
 * </Select>
 * ```
 *
 * It is controlled: `value` + `onChange(value)`, no event. With React Hook Form spread `field`
 * inside `FormField` > `FormControl` (or a `Controller`), not `register`: the field is a button,
 * not a native `<select>`.
 */
export function Select({
  value,
  onChange,
  children,
  placeholder,
  className,
  name,
  disabled,
  required,
  ...triggerProps
}: SelectProps) {
  const current = value ?? '';
  return (
    <SelectPrimitive.Root
      value={current === '' && placeholder !== undefined ? '' : toSelectItem(current)}
      onValueChange={(next) => onChange(fromSelectItem(next))}
      {...(name === undefined ? {} : { name })}
      disabled={disabled ?? false}
      required={required ?? false}
    >
      <SelectPrimitive.Trigger
        data-input
        className={cn(
          inputClass,
          'flex items-center justify-between gap-2 text-left data-[placeholder]:text-tertiary',
          className,
        )}
        {...triggerProps}
      >
        {/* One line whatever the choice: a long name is cut with an ellipsis, not wrapped. */}
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          className="relative z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] origin-[var(--radix-select-content-transform-origin)] overflow-hidden rounded-xl border border-border-subtle bg-white shadow-floating motion-safe:animate-menu-in"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted">
            <ChevronUp className="size-4" aria-hidden />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted">
            <ChevronDown className="size-4" aria-hidden />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** One choice of a `Select`. Its children are the text shown in the list and, once chosen, in the field. */
export function SelectItem({
  value,
  disabled,
  className,
  children,
}: {
  value: string;
  disabled?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <SelectPrimitive.Item
      value={toSelectItem(value)}
      disabled={disabled ?? false}
      className={cn(
        'relative flex min-h-9 cursor-pointer items-center rounded-[7px] py-2 pr-3 pl-8 text-[13px] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover data-[state=checked]:font-medium',
        className,
      )}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2.5 inline-flex">
        <Check className="size-4 text-primary" aria-hidden />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
