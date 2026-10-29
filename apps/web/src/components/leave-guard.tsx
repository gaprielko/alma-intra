import { sk } from '@intra/shared/i18n';
import { useBlocker } from '@tanstack/react-router';
import { useRef } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const t = sk.common.discardChanges;

/**
 * Asks „Zahodiť neuložené zmeny?“ before leaving a form with unsaved changes, inside the app and
 * when closing or reloading the tab. Pass `saving` while the save runs: the page then leaves on
 * its own after a successful save without asking.
 */
export function LeaveGuard({ dirty, saving = false }: { dirty: boolean; saving?: boolean }) {
  const block = useRef(false);
  block.current = dirty && !saving;
  const blocker = useBlocker({
    shouldBlockFn: () => block.current,
    enableBeforeUnload: () => block.current,
    withResolver: true,
  });
  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
      title={t.title}
      description={t.text}
      confirmLabel={t.confirm}
      cancelLabel={t.stay}
      onConfirm={() => blocker.proceed?.()}
    />
  );
}
