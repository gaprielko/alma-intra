import { sk } from '@intra/shared/i18n';
import { COMPANY_ROOT_FOLDER_ID, FILE_ACCEPT } from '@intra/shared/schemas';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FileBadge } from '@/components/files/file-bits';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatSize } from '@/lib/files';
import { trpc } from '@/lib/trpc';
import { uploadFiles } from '@/lib/uploads';
import { cn } from '@/lib/utils';

const t = sk.activities.picker;

/** A picked file: the current version is kept when the activity (or the e-mail) is saved. */
export interface PickedFile {
  fileId: string;
  name: string;
  size: number;
  version: number;
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * „Priložiť súbory“: the customer's folder first, the company's documents a tab away, and an
 * upload from the computer that lands in the customer's folder and is picked at once. Without a
 * customer (a template's default attachments) only the company's documents, and an upload lands
 * in „Firemné dokumenty“.
 */
export function FilePicker({
  customerId,
  lead,
  notes,
  already,
  imagePick,
  onClose,
  onPick,
}: {
  customerId?: string | undefined;
  /** The line under the title: who the files are for. */
  lead: string;
  /** What attaching means here; the activity's words by default. */
  notes?: string[] | undefined;
  /** Files attached already: not offered again. */
  already: ReadonlySet<string>;
  /** One picture for an e-mail instead of files to attach; the button's word. */
  imagePick?: string | undefined;
  onClose: () => void;
  onPick: (files: PickedFile[]) => void;
}) {
  const [scope, setScope] = useState<'customer' | 'company'>(customerId ? 'customer' : 'company');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [picked, setPicked] = useState<Map<string, PickedFile>>(new Map());
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useQuery({
    ...trpc.activity.pickableFiles.queryOptions({
      scope,
      ...(customerId ? { customerId } : {}),
      ...(search ? { search } : {}),
      ...(imagePick ? { imagesOnly: true } : {}),
    }),
    placeholderData: keepPreviousData,
  });
  const customerFolder = useQuery({
    ...trpc.file.customerFolder.queryOptions({ customerId: customerId ?? '' }),
    enabled: customerId !== undefined,
  });
  const uploadFolder = customerId ? customerFolder.data?.id : COMPANY_ROOT_FOLDER_ID;
  const files = (list.data?.files ?? []).filter((file) => !already.has(file.id));
  const total = [...picked.values()].reduce((sum, file) => sum + file.size, 0);

  const toggle = (file: PickedFile) =>
    setPicked((current) => {
      const next = new Map(imagePick ? [] : current);
      if (current.has(file.fileId)) next.delete(file.fileId);
      else next.set(file.fileId, file);
      return next;
    });

  const upload = async (chosen: File[]) => {
    const rootId = uploadFolder;
    if (!rootId || chosen.length === 0) return;
    setUploading(true);
    try {
      // Into the customer's folder, whichever tab is open.
      const arrived = await uploadFiles(chosen, rootId);
      setPicked((current) => {
        const next = new Map(imagePick ? [] : current);
        for (const file of arrived) next.set(file.fileId, { ...file, version: 1 });
        return next;
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{imagePick ? sk.templates.editor.fromFilesTitle : t.title}</DialogTitle>
          <DialogDescription>{lead}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {customerId ? (
            <div
              role="tablist"
              aria-label={t.tabs.label}
              className="flex rounded-[10px] bg-surface p-1"
            >
              {(['customer', 'company'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={scope === key}
                  onClick={() => setScope(key)}
                  className={cn(
                    'h-8 rounded-lg px-3 text-[13px] font-semibold transition-colors',
                    scope === key ? 'bg-white text-primary-text shadow-rest' : 'text-muted',
                  )}
                >
                  {t.tabs[key]}
                </button>
              ))}
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={uploading || !uploadFolder}
            onClick={() => input.current?.click()}
          >
            <Upload className="size-3.5" aria-hidden />
            {t.upload}
          </Button>
          <input
            ref={input}
            type="file"
            multiple={!imagePick}
            hidden
            accept={imagePick ? 'image/png,image/jpeg' : FILE_ACCEPT}
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];
              event.target.value = '';
              void upload(chosen);
            }}
          />
        </div>

        <label className="flex h-9 items-center gap-2 rounded-[10px] border border-border px-3 focus-within:border-primary">
          <Search className="size-[15px] shrink-0 text-tertiary" aria-hidden />
          <span className="sr-only">{t.search}</span>
          <input
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={t.search}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-tertiary"
          />
        </label>

        <ul className="max-h-72 min-h-24 divide-y divide-border-subtle overflow-y-auto rounded-xl border border-border-subtle">
          {files.map((file) => {
            const item = {
              fileId: file.id,
              name: file.name,
              size: file.size,
              version: file.version,
            };
            const checked = picked.has(file.id);
            return (
              <li key={file.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-hover">
                  <Checkbox
                    checked={checked}
                    onChange={() => toggle(item)}
                    aria-label={t.select(file.name)}
                  />
                  <FileBadge name={file.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{file.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {t.meta(file.folderName, file.version)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{formatSize(file.size)}</span>
                </label>
              </li>
            );
          })}
          {list.data && files.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted">{t.empty}</li>
          ) : null}
        </ul>

        <div className="space-y-1 text-xs text-muted">
          {(notes ?? [t.versionNote, t.uploadNote]).map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>

        <DialogFooter className="items-center">
          {picked.size > 0 ? (
            <p className="mr-auto text-[13px] font-medium text-muted">
              {t.selected(picked.size, formatSize(total))}
            </p>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={picked.size === 0 || uploading}
            onClick={() => {
              onPick([...picked.values()]);
              onClose();
            }}
          >
            {imagePick ?? t.attach}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
