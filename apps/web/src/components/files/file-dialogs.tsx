import { sk } from '@intra/shared/i18n';
import { COMPANY_ROOT_FOLDER_ID, FILE_ACCEPT, fileExtension } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight, Folder } from 'lucide-react';
import { useState } from 'react';
import { TextDialog } from '@/components/files/file-bits';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { splitName, uploadRefusal } from '@/lib/files';
import { trpc } from '@/lib/trpc';
import { uploadVersion } from '@/lib/uploads';
import { cn } from '@/lib/utils';

const t = sk.files;

export interface FileRef {
  id: string;
  name: string;
  folderId: string;
  description?: string | null;
}

export interface FolderRef {
  id: string;
  name: string;
  parentId: string;
}

/** What a file's menu or a folder's menu opened. */
export type FilesDialog =
  | { kind: 'renameFile' | 'describe' | 'moveFile' | 'version'; file: FileRef }
  | { kind: 'newFolder'; parentId: string }
  | { kind: 'renameFolder' | 'moveFolder' | 'deleteFolder'; folder: FolderRef };

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries(trpc.file.pathFilter());
}

/** The one dialog a menu of the Files module opened, with its request. */
export function FilesDialogs({
  dialog,
  onClose,
  onFolderDeleted,
}: {
  dialog: FilesDialog | null;
  onClose: () => void;
  /** A deleted folder that was open hands the view to its parent. */
  onFolderDeleted?: (folderId: string, parentId: string) => void;
}) {
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'renameFile':
      return <RenameFile file={dialog.file} onClose={onClose} />;
    case 'describe':
      return <DescribeFile file={dialog.file} onClose={onClose} />;
    case 'moveFile':
      return <MoveDialog item={{ kind: 'file', ...dialog.file }} onClose={onClose} />;
    case 'version':
      return <VersionDialog file={dialog.file} onClose={onClose} />;
    case 'newFolder':
      return <NewFolder parentId={dialog.parentId} onClose={onClose} />;
    case 'renameFolder':
      return <RenameFolder folder={dialog.folder} onClose={onClose} />;
    case 'moveFolder':
      return (
        <MoveDialog
          item={{
            kind: 'folder',
            id: dialog.folder.id,
            name: dialog.folder.name,
            folderId: dialog.folder.parentId,
          }}
          onClose={onClose}
        />
      );
    case 'deleteFolder':
      return <DeleteFolder folder={dialog.folder} onClose={onClose} onDeleted={onFolderDeleted} />;
  }
}

function RenameFile({ file, onClose }: { file: FileRef; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { base, ext } = splitName(file.name);
  const rename = useMutation(
    trpc.file.rename.mutationOptions({
      onSuccess: async () => {
        toast('success', t.renameDialog.done);
        await refresh();
        onClose();
      },
    }),
  );
  return (
    <TextDialog
      title={t.renameDialog.title}
      description={t.renameDialog.hint}
      label={t.renameDialog.field}
      initial={base}
      suffix={ext}
      pending={rename.isPending}
      error={rename.error ? errorMessage(rename.error, { ...sk.validation, ...t.errors }) : null}
      onClose={onClose}
      onSave={(name) => rename.mutate({ id: file.id, name })}
    />
  );
}

function DescribeFile({ file, onClose }: { file: FileRef; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const describe = useMutation(
    trpc.file.describe.mutationOptions({
      onSuccess: async () => {
        toast('success', t.describeDialog.done);
        await refresh();
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  return (
    <TextDialog
      title={t.describeDialog.title}
      label={t.describeDialog.field}
      initial={file.description ?? ''}
      multiline
      allowEmpty
      maxLength={1000}
      pending={describe.isPending}
      onClose={onClose}
      onSave={(description) => describe.mutate({ id: file.id, description })}
    />
  );
}

function NewFolder({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const create = useMutation(
    trpc.file.createFolder.mutationOptions({
      onSuccess: async () => {
        toast('success', t.folderDialog.created);
        await refresh();
        onClose();
      },
    }),
  );
  return (
    <TextDialog
      title={t.folderDialog.newTitle}
      label={t.folderDialog.field}
      initial=""
      submitLabel={t.folderDialog.create}
      pending={create.isPending}
      error={create.error ? errorMessage(create.error, { ...sk.validation, ...t.errors }) : null}
      onClose={onClose}
      onSave={(name) => create.mutate({ parentId, name })}
    />
  );
}

function RenameFolder({ folder, onClose }: { folder: FolderRef; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const rename = useMutation(
    trpc.file.renameFolder.mutationOptions({
      onSuccess: async () => {
        toast('success', t.folderDialog.renamed);
        await refresh();
        onClose();
      },
    }),
  );
  return (
    <TextDialog
      title={t.folderDialog.renameTitle}
      label={t.folderDialog.field}
      initial={folder.name}
      pending={rename.isPending}
      error={rename.error ? errorMessage(rename.error, { ...sk.validation, ...t.errors }) : null}
      onClose={onClose}
      onSave={(name) => rename.mutate({ id: folder.id, name })}
    />
  );
}

function DeleteFolder({
  folder,
  onClose,
  onDeleted,
}: {
  folder: FolderRef;
  onClose: () => void;
  onDeleted?: ((folderId: string, parentId: string) => void) | undefined;
}) {
  const toast = useToast();
  const refresh = useRefresh();
  const remove = useMutation(
    trpc.file.deleteFolder.mutationOptions({
      onSuccess: async (result) => {
        toast('success', t.deleteFolder.done);
        onDeleted?.(folder.id, result.parentId);
        await refresh();
        onClose();
      },
      onError: (error) => {
        toast('error', errorMessage(error, t.errors));
        onClose();
      },
    }),
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t.deleteFolder.title(folder.name)}
      description={t.deleteFolder.text}
      confirmLabel={t.deleteFolder.confirm}
      pending={remove.isPending}
      onConfirm={() => remove.mutate({ id: folder.id })}
    />
  );
}

/** A new version: pick the file, say what changed, watch it go. */
function VersionDialog({ file, onClose }: { file: FileRef; onClose: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ext = fileExtension(file.name);

  const submit = async () => {
    if (!picked) return;
    const refusal = uploadRefusal(picked);
    if (refusal) {
      setError(t.uploads[refusal]);
      return;
    }
    if (fileExtension(picked.name) !== ext) {
      setError(t.errors.TYPE_MISMATCH);
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const number = await uploadVersion(picked, file.id, note.trim() || undefined, setProgress);
      toast('success', t.versionDialog.done(number));
      onClose();
    } catch (failure) {
      setProgress(null);
      setError(errorMessage(failure, t.errors, t.uploads.failed));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && progress === null && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.versionDialog.title}</DialogTitle>
          <DialogDescription>{t.versionDialog.text(file.name)}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="version-file">{t.versionDialog.file}</Label>
            <Input
              id="version-file"
              type="file"
              accept={ext ? `.${ext}` : FILE_ACCEPT}
              className="pt-2"
              onChange={(event) => {
                setPicked(event.target.files?.[0] ?? null);
                setError(null);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="version-note">
              {t.versionDialog.note}{' '}
              <span className="font-normal text-muted">({sk.common.optional})</span>
            </Label>
            <Input
              id="version-note"
              maxLength={300}
              placeholder={t.versionDialog.notePlaceholder}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {progress !== null ? (
            <div
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 overflow-hidden rounded-full bg-track"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={progress !== null}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={!picked || progress !== null}>
              {t.versionDialog.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Movable = { kind: 'file' | 'folder'; id: string; name: string; folderId: string };

/**
 * Where to move a file or a folder: a browser of the folders, starting where the item is. A file
 * may go anywhere, between the company's documents and the customers' folders too; a folder stays
 * in its own tree, and never goes into itself.
 */
function MoveDialog({ item, onClose }: { item: Movable; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [at, setAt] = useState(item.folderId);
  const [customerSearch, setCustomerSearch] = useState('');
  const contents = useQuery(trpc.file.contents.queryOptions({ folderId: at }));
  const customers = useQuery({
    ...trpc.file.customerFolders.queryOptions({ search: customerSearch.trim() || undefined }),
    enabled: item.kind === 'file' && at === COMPANY_ROOT_FOLDER_ID,
  });
  const onDone = async () => {
    toast('success', t.moveDialog.done);
    await refresh();
    onClose();
  };
  const onError = (error: unknown) => toast('error', errorMessage(error, t.errors));
  const moveFile = useMutation(trpc.file.move.mutationOptions({ onSuccess: onDone, onError }));
  const moveFolder = useMutation(
    trpc.file.moveFolder.mutationOptions({ onSuccess: onDone, onError }),
  );
  const pending = moveFile.isPending || moveFolder.isPending;

  const path = contents.data?.path ?? [];
  const inCustomer = path[0]?.customerId != null;
  const subfolders = (contents.data?.folders ?? []).filter((f) => f.id !== item.id);
  const unchanged = at === item.folderId;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t.moveDialog.title(item.name)}</DialogTitle>
          <DialogDescription>{t.moveDialog.text}</DialogDescription>
        </DialogHeader>
        <nav aria-label={t.breadcrumb} className="flex flex-wrap items-center gap-1 text-[13px]">
          {item.kind === 'file' && inCustomer ? (
            <>
              <button
                type="button"
                className="font-medium text-primary-text hover:underline"
                onClick={() => setAt(COMPANY_ROOT_FOLDER_ID)}
              >
                {t.tree.company}
              </button>
              <ChevronRight className="size-3.5 text-tertiary" aria-hidden />
            </>
          ) : null}
          {path.map((step, i) => (
            <span key={step.id} className="inline-flex items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3.5 text-tertiary" aria-hidden /> : null}
              {i === path.length - 1 ? (
                <span className="font-semibold">{step.name}</span>
              ) : (
                <button
                  type="button"
                  className="font-medium text-primary-text hover:underline"
                  onClick={() => setAt(step.id)}
                >
                  {step.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <ul className="max-h-72 min-h-24 divide-y divide-border-subtle overflow-y-auto rounded-xl border border-border-subtle">
          {subfolders.map((folder) => (
            <li key={folder.id}>
              <button
                type="button"
                onClick={() => setAt(folder.id)}
                className="flex h-11 w-full items-center gap-2.5 px-3 text-left text-sm font-medium hover:bg-hover"
              >
                <Folder className="size-4 text-muted" aria-hidden />
                <span className="truncate">{folder.name}</span>
                <ChevronRight className="ml-auto size-4 text-tertiary" aria-hidden />
              </button>
            </li>
          ))}
          {item.kind === 'file' && at === COMPANY_ROOT_FOLDER_ID ? (
            <li className="p-2">
              <Input
                aria-label={t.tree.findCustomer}
                placeholder={t.tree.findCustomer}
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                className="h-9"
              />
              <ul className="mt-1">
                {(customers.data?.items ?? []).map((customer) => (
                  <li key={customer.folderId}>
                    <button
                      type="button"
                      onClick={() => setAt(customer.folderId)}
                      className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-hover"
                    >
                      <Building2 className="size-4 text-muted" aria-hidden />
                      <span className="truncate">{customer.name}</span>
                      <ChevronRight className="ml-auto size-4 text-tertiary" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
          {subfolders.length === 0 && !(item.kind === 'file' && at === COMPANY_ROOT_FOLDER_ID) ? (
            <li className={cn('px-3 py-6 text-center text-sm text-muted')}>{t.empty}</li>
          ) : null}
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={pending || unchanged || contents.isPending}
            onClick={() =>
              item.kind === 'file'
                ? moveFile.mutate({ id: item.id, folderId: at })
                : moveFolder.mutate({ id: item.id, parentId: at })
            }
          >
            {t.moveDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
