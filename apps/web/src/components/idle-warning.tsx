import { sk } from '@intra/shared/i18n';
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
 * two minutes before the idle logout. It needs no handler of its own: pressing its
 * button, Escape, a click anywhere, any key is an interaction, which starts the hour again and
 * withdraws the warning (`watchInactivity`).
 */
export function IdleWarning({ open }: { open: boolean }) {
  const t = sk.auth.idleWarning;
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent role="alertdialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button>{t.stay}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
