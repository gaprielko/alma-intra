import { sk } from '@intra/shared/i18n';
import type { FileGroup } from '@intra/shared/schemas';
import { Check, ChevronDown, ChevronUp, Folder, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fileBadge } from '@/lib/files';
import { useUploads } from '@/lib/uploads';
import { cn } from '@/lib/utils';

/** The colours of a file's badge, by its group; the extension itself is the label. */
const GROUP_CLASS: Record<FileGroup, string> = {
  pdf: 'bg-[#fce8e8] text-[#b0232a]',
  document: 'bg-[#e6f1fb] text-[#0c447c]',
  spreadsheet: 'bg-[#eaf3de] text-[#3b6d11]',
  presentation: 'bg-[#fcf0de] text-[#b45309]',
  image: 'bg-[#f0ebfa] text-[#5b3fa0]',
  video: 'bg-[#fbe9f3] text-[#9d2766]',
  text: 'bg-surface text-muted',
  archive: 'bg-[#e9eef6] text-[#334e7b]',
};

/** A file's type at a glance: `PDF` on red, `DOCX` on blue, … */
export function FileBadge({ name, large = false }: { name: string; large?: boolean }) {
  const badge = fileBadge(name);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold tracking-[0.02em]',
        large ? 'size-12 rounded-xl text-xs' : 'size-[34px] rounded-[9px] text-[10px]',
        badge.group ? GROUP_CLASS[badge.group] : 'bg-surface text-muted',
      )}
    >
      {badge.label}
    </span>
  );
}

export function FolderTile() {
  return (
    <span
      aria-hidden
      className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-primary-soft text-primary-text"
    >
      <Folder className="size-[17px]" />
    </span>
  );
}

/** Who made a version: a colleague, or later „Claude za …“ with Claude's mark. */
export function ChangedBy({ name, via }: { name: string | null; via: string }) {
  if (!name) return <>{sk.common.none}</>;
  if (via !== 'mcp') return <>{name}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        aria-hidden
        className="inline-flex size-[18px] items-center justify-center rounded-[5px] bg-warning-soft text-[10px] font-bold text-warning not-italic"
      >
        C
      </i>
      {sk.files.byClaude(name)}
    </span>
  );
}

const u = sk.files.uploads;

/** The uploads running and just finished, at the bottom right of every screen. */
export function UploadPanel() {
  const { items, collapsed, toggle, dismiss } = useUploads();
  if (items.length === 0) return null;
  const running = items.some((item) => item.status === 'waiting' || item.status === 'uploading');
  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const finished = items.filter((item) => item.status === 'done' || item.status === 'failed');
  const title = running
    ? u.progress(finished.length, items.length)
    : failed > 0
      ? `${u.finished(done)}. ${u.failedCount(failed)}`
      : u.finished(done);
  return (
    <div
      role="status"
      className="fixed right-7 bottom-7 z-40 w-[min(340px,calc(100vw-2rem))] rounded-[14px] bg-[#0c2b2c] px-4 py-3.5 text-white shadow-[0_12px_32px_rgba(12,43,44,0.3)]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <div className="flex items-center">
          <button
            type="button"
            aria-label={collapsed ? u.expand : u.collapse}
            onClick={toggle}
            className="rounded-md p-1 text-[#a9c9c7] hover:text-white"
          >
            {collapsed ? (
              <ChevronUp className="size-4" aria-hidden />
            ) : (
              <ChevronDown className="size-4" aria-hidden />
            )}
          </button>
          {running ? null : (
            <button
              type="button"
              aria-label={u.dismiss}
              onClick={dismiss}
              className="rounded-md p-1 text-[#a9c9c7] hover:text-white"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {collapsed ? null : (
        <ul className="mt-2 max-h-60 space-y-2.5 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <p className="flex justify-between gap-3 text-[13px] text-[#d7f2ef]">
                <span className="truncate">{item.name}</span>
                <span className="shrink-0">
                  {item.status === 'uploading' ? (
                    `${Math.round(item.progress * 100)} %`
                  ) : item.status === 'done' ? (
                    <Check className="size-4 text-[#5fd0c9]" aria-label={u.done} />
                  ) : item.status === 'waiting' ? (
                    u.waiting
                  ) : null}
                </span>
              </p>
              {item.status === 'failed' ? (
                <p className="text-xs text-[#ffb4b4]">{item.error}</p>
              ) : (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-[#5fd0c9] transition-[width] duration-150"
                    style={{ width: `${Math.round(item.progress * 100)}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One field in a dialog: a folder's name, a file's name (with its extension fixed behind the
 * field), a description.
 */
export function TextDialog({
  title,
  description,
  label,
  initial,
  suffix,
  multiline = false,
  submitLabel = sk.common.save,
  allowEmpty = false,
  maxLength = 200,
  pending,
  error,
  onClose,
  onSave,
}: {
  title: string;
  description?: string;
  label: string;
  initial: string;
  /** Shown after the field and added to the value: the extension of a file. */
  suffix?: string;
  multiline?: boolean;
  submitLabel?: string;
  allowEmpty?: boolean;
  maxLength?: number;
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ready = allowEmpty || value.trim() !== '';
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onSave(value.trim() + (suffix ?? ''));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="text-dialog-field">{label}</Label>
            {multiline ? (
              <Textarea
                id="text-dialog-field"
                autoFocus
                rows={4}
                maxLength={maxLength}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  id="text-dialog-field"
                  autoFocus
                  maxLength={maxLength}
                  value={value}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'text-dialog-error' : undefined}
                  onChange={(event) => setValue(event.target.value)}
                />
                {suffix ? <span className="shrink-0 text-sm text-muted">{suffix}</span> : null}
              </div>
            )}
            {error ? (
              <p id="text-dialog-error" className="text-[13px] text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={pending || !ready}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
