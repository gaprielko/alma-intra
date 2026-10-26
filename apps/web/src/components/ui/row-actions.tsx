import { sk } from '@intra/shared/i18n';
import { ChevronRight, Download, Pencil, RotateCcw, Trash2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * One icon per action, app-wide (ALMA-288 items 23 and 15). Edit is a pencil, delete a trash can
 * (only where something is really deleted), open a chevron, download an arrow down, restore an
 * arrow back. Ending something (a plan item, a membership) is not deleting it: it is the word
 * „Ukončiť“, never a trash can or an unclear symbol. Only what destroys is red.
 */
export type RowActionKind = 'edit' | 'delete' | 'end' | 'restore' | 'open' | 'download';

export interface RowActionLook {
  /** The icon, or `null` for an action that is its word. */
  icon: LucideIcon | null;
  /** The word on the button (an action without an icon) or in the tooltip (an icon). */
  name: string;
  destructive: boolean;
}

export function rowActionLook(kind: RowActionKind): RowActionLook {
  const n = sk.common.rowActions;
  switch (kind) {
    case 'edit':
      return { icon: Pencil, name: n.edit, destructive: false };
    case 'delete':
      return { icon: Trash2, name: n.delete, destructive: true };
    case 'end':
      return { icon: null, name: n.end, destructive: true };
    case 'restore':
      return { icon: RotateCcw, name: n.restore, destructive: false };
    case 'open':
      return { icon: ChevronRight, name: n.open, destructive: false };
    case 'download':
      return { icon: Download, name: n.download, destructive: false };
  }
}

export interface RowAction {
  kind: RowActionKind;
  /** What a screen reader hears: the action and its object („Upraviť · 3407“). */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** The word of a worded action, where the context has a better one („Odobrať“ in a draft). */
  name?: string;
}

/**
 * The actions at the end of a row or a list item: the same size (32 px), the same 6 px between
 * them, a tooltip on every icon. Clicks stay here: a clickable row does not open under them.
 */
export function RowActions({
  actions,
  className,
}: {
  actions: RowAction[];
  className?: string | undefined;
}) {
  return (
    <span data-row-ignore className={cn('inline-flex items-center justify-end gap-1.5', className)}>
      {actions.map((action) => {
        const look = rowActionLook(action.kind);
        if (!look.icon) {
          return (
            <Button
              key={action.kind}
              variant="ghost"
              size="sm"
              aria-label={action.label}
              disabled={action.disabled}
              className={cn(look.destructive && 'text-danger hover:bg-danger-soft')}
              onClick={action.onClick}
            >
              {action.name ?? look.name}
            </Button>
          );
        }
        const Icon = look.icon;
        return (
          <Tooltip key={action.kind} text={action.name ?? look.name}>
            <Button
              size="icon"
              aria-label={action.label}
              disabled={action.disabled}
              className={cn(
                'size-8',
                look.destructive ? 'hover:bg-danger-soft hover:text-danger' : 'text-primary-text',
              )}
              onClick={action.onClick}
            >
              <Icon className="size-4" aria-hidden />
            </Button>
          </Tooltip>
        );
      })}
    </span>
  );
}
