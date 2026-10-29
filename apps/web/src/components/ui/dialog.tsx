import * as DialogPrimitive from '@radix-ui/react-dialog';
import { sk } from '@intra/shared/i18n';
import { X, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui dialog over Radix: focus trap, Escape, click outside and `aria-*` wiring come from the
 * primitive. `DialogContent` renders the overlay too, so a screen composes `Dialog` + `DialogContent`
 * + `DialogTitle` (required for the accessible name) and the rest.
 *
 * The look: a dark teal backdrop at 55 % with a 4 px blur, the dialog rounded
 * 24 on Elevation/3, 480 / 640 / 880 wide (`size`), fading in while growing from 0.98. The body
 * keeps a 20 px rhythm; `DialogFooter` sits on bg/subtle under a subtle line, its actions on the
 * right. `DialogIcon` is the 40 px soft circle before the title.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * A toast is not „outside“ the dialog: it lives in its own layer (`data-toast`, ui/toast.tsx), and
 * closing an error toast must not close the dialog under it and throw away what was typed.
 */
export const onToast = (event: Event) =>
  event.target instanceof Element && event.target.closest('[data-toast]') !== null;

const SIZE = {
  sm: 'max-w-[30rem]',
  md: 'max-w-[40rem]',
  lg: 'max-w-[55rem]',
} as const;

export type DialogSize = keyof typeof SIZE;

export function DialogContent({
  className,
  overlayClassName,
  children,
  size = 'sm',
  nested = false,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  size?: DialogSize;
  /** The ⌘K palette sits on a lighter backdrop (W11). */
  overlayClassName?: string | undefined;
  /**
   * A dialog opened from another one: its backdrop and content go above the first dialog, so that
   * one is dimmed too (z-50 would leave it on top of the backdrop).
   */
  nested?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 bg-dark/55 backdrop-blur-[4px] motion-safe:animate-fade-in',
          nested ? 'z-[55]' : 'z-40',
          overlayClassName,
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-3xl bg-white p-6 shadow-floating outline-none motion-safe:animate-scale-in',
          nested ? 'z-[56]' : 'z-50',
          SIZE[size],
          className,
        )}
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

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props} />;
}

/** The icon of a dialog's header: 40 px in a soft circle of the dialog's kind, before the title. */
const ICON_TONE = {
  primary: 'bg-primary-soft text-primary-text',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

export function DialogIcon({
  icon: Icon,
  tone = 'primary',
}: {
  icon: LucideIcon;
  tone?: keyof typeof ICON_TONE;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'mb-2 inline-flex size-10 items-center justify-center rounded-full',
        ICON_TONE[tone],
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

/**
 * The footer: it stays in view at the bottom of a long dialog, on bg/subtle under a subtle line,
 * reaching the dialog's edges whatever the body's padding. The body ends 20 px above its line in
 * every dialog: the dialog's own column gives the gap when the footer is its
 * child, and so does a form that is a flex column, a grid or `contents`; inside a form laid out
 * as a block (`space-y-4`), the footer keeps the 20 px itself (its margin meets the last field's
 * 16 and the larger one counts).
 */
export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'sticky -bottom-6 -mx-6 -mb-6 mt-auto flex [:not(.flex,.grid,.contents)>&]:mt-5 flex-wrap justify-end gap-2 rounded-b-3xl border-t border-border-subtle bg-subtle px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-[17px] leading-[22px] font-semibold tracking-[-0.01em]', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-[13px] leading-[18px] text-muted', className)}
      {...props}
    />
  );
}

/** A body section of a dialog with the 20 px rhythm between its blocks. */
export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-col gap-5', className)}>{children}</div>;
}
