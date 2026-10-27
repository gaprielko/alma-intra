import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui popover over Radix: a panel next to a field (the calendar of `DatePicker`, the hours
 * of `TimePicker`). Escape, click outside and focus return come from the primitive; it works
 * inside `Dialog` too. `PopoverAnchor` lets the panel line up with a whole field while only its
 * icon button is the `PopoverTrigger`. The look is the dropdown's: Elevation/3,
 * rounded 12, opening in 120 ms from its anchor.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 origin-[var(--radix-popover-content-transform-origin)] rounded-xl border border-border-subtle bg-white p-3 shadow-floating outline-none motion-safe:animate-menu-in',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
