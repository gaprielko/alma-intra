import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui dropdown over Radix: keyboard navigation, typeahead, focus return and `aria-*` come
 * from the primitive. The look: Elevation/3, rounded 12, 6 px padding, at
 * least 220 wide, opening in 120 ms from its anchor. An item is 36 high, rounded 7, with its icon
 * in accent/soft and the hover tint; `destructive` paints it danger, and it goes last.
 */
export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-[220px] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-xl border border-border-subtle bg-white p-1.5 shadow-floating outline-none motion-safe:animate-menu-in',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex min-h-9 cursor-pointer items-start gap-3 rounded-[7px] px-3 py-2 text-[13px] leading-5 outline-none select-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:mt-0.5 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-primary-text',
        destructive && 'text-danger [&>svg]:text-danger data-[highlighted]:bg-danger-soft',
        className,
      )}
      {...props}
    />
  );
}

/** The name of a group of items: 11 px caps in tertiary, not an item. */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn(
        'px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-tertiary uppercase',
        className,
      )}
      {...props}
    />
  );
}

/** A line between two groups of items, with 4 px of air on each side. */
export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn('my-1 h-px bg-border-subtle', className)} {...props} />
  );
}

/** A keyboard shortcut at the right end of an item. */
export function DropdownMenuShortcut({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'ml-auto self-center rounded border border-border px-1 font-sans text-[10.5px] text-tertiary',
        className,
      )}
      {...props}
    />
  );
}

/**
 * An item with a box to tick, drawn like the Figma `Checkbox`: 18×18, rounded 5,
 * `primary` with a white tick when on. Radix gives it `menuitemcheckbox` and `aria-checked`.
 */
export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked ?? false}
      className={cn(
        'flex min-h-9 cursor-pointer items-center gap-3 rounded-[7px] px-3 py-2 text-[13px] leading-5 outline-none select-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
          checked ? 'border-primary bg-primary text-white' : 'border-border bg-white',
        )}
      >
        {checked === true ? (
          <Check className="size-3.5" strokeWidth={3} />
        ) : checked === 'indeterminate' ? (
          <Minus className="size-3.5" strokeWidth={3} />
        ) : null}
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}
