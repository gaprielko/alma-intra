import * as DialogPrimitive from '@radix-ui/react-dialog';
import { sk } from '@intra/shared/i18n';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { onToast } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * A side panel (ALMA-303): the dialog's primitive, docked to the right edge instead of centred, for
 * a list that is read beside the page it comes from („Štatistiky“ opens the rows behind a number).
 * Focus trap, Escape, click outside and `aria-*` wiring are Radix's, as in `Dialog`; a screen
 * composes `Sheet` + `SheetContent` + `DialogTitle` (required for the accessible name).
 */
export const Sheet = DialogPrimitive.Root;

export function SheetContent({
  className,
  children,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-dark/40 motion-safe:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[min(52rem,100vw)] flex-col gap-4 overflow-y-auto bg-white p-6 shadow-floating outline-none motion-safe:animate-fade-in',
          className,
        )}
        // As in `Dialog`: a toast is its own layer, and closing one must not close the panel.
        onPointerDownOutside={(event) => {
          if (onToast(event)) event.preventDefault();
          else onPointerDownOutside?.(event);
        }}
        onInteractOutside={(event) => {
          if (onToast(event)) event.preventDefault();
          else onInteractOutside?.(event);
        }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-[10px] text-muted transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={sk.common.close}
        >
          <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
