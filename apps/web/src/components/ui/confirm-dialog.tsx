import { sk } from '@intra/shared/i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The one question before something that cannot be taken back (ALMA-170, item 22): discarding an
 * intake, cancelling a visit, taking a patient from a nurse, logging out… Never the browser's
 * `window.confirm` (the ESLint config bans it).
 *
 * - `title` is the question („Zahodiť návrh plánu?“), `description` one sentence of what follows.
 * - `confirmLabel` names the action („Zahodiť návrh“), never „OK“ or „Áno“; the button is red.
 * - Focus starts on „Zrušiť“, so Enter or a hasty Space does not confirm.
 * - It is controlled: `open` + `onOpenChange`. It does not close itself on confirm, because the
 *   action usually is a mutation — close it in `onSuccess` (or right away for a synchronous one),
 *   and pass `pending` meanwhile so the button cannot be pressed twice. A failure is the caller's
 *   error toast; the dialog stays open, so the user can try again or cancel.
 * - `children` is for the rare extra line under the description (a count, a name list).
 * - `destructive={false}` for the undo of a destructive action asked the same way (unblocking
 *   after blocking): the confirm button is then the primary one, not red.
 *
 * A destructive action that needs a reason (nurse deactivation, suspending an organization) keeps
 * its own dialog with the form; this one only asks.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = sk.common.cancel,
  onConfirm,
  pending = false,
  destructive = true,
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** „Zrušiť“ unless the question needs its own words („Zostať“ before leaving a form). */
  cancelLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  destructive?: boolean;
  /** The confirm button waits for something in `children` (a box to tick), not for a request. */
  confirmDisabled?: boolean;
  children?: ReactNode;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  // The confirm button is disabled while the action runs, which would drop focus to the page:
  // „Zrušiť“ takes it (it stays focusable, only inert), so a keyboard user is still in the dialog
  // when a refusal arrives.
  useEffect(() => {
    if (pending) cancel.current?.focus();
  }, [pending]);
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent
        role="alertdialog"
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            ref={cancel}
            variant="ghost"
            aria-disabled={pending || undefined}
            className="aria-disabled:opacity-50"
            onClick={() => (pending ? undefined : onOpenChange(false))}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
