import { sk } from '@intra/shared/i18n';
import {
  COMPANY_ROOT_FOLDER_ID,
  FILE_ACCEPT,
  FILE_GROUPS,
  FILE_PERIODS,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Building2, Folder, FolderPlus, MoreVertical, Search, Trash2, Upload } from 'lucide-react';
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { FilterMenu } from '@/components/customers/customer-bits';
import { ChangedBy, FileBadge, FolderTile } from '@/components/files/file-bits';
import { type FilesDialog, FilesDialogs } from '@/components/files/file-dialogs';
import { FileSheet } from '@/components/files/file-sheet';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { TableShell } from '@/components/table-shell';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusBanner } from '@/components/ui/status-banner';
import { TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { canPreview, formatSize } from '@/lib/files';
import { formatDate, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { downloadFile, previewFile, uploadFiles } from '@/lib/uploads';
import { cn } from '@/lib/utils';

const t = sk.files;

const search = z.object({
  folder: z.string().uuid().optional(),
  q: z.string().optional(),
  group: z.enum(FILE_GROUPS).optional(),
  by: z.string().uuid().optional(),
  period: z.enum(FILE_PERIODS).optional(),
  /** The file whose sheet is open. */
  file: z.string().uuid().optional(),
  view: z.enum(['trash']).optional(),
});
type FilesSearch = z.infer<typeof search>;

export const Route = createFileRoute('/_app/files')({
  validateSearch: search,
  component: FilesPage,
});

type Contents = RouterOutputs['file']['contents'];
type FileRow = Contents['files'][number];

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function FilesPage() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const canWrite = useCan('file.write');
  const [dialog, setDialog] = useState<FilesDialog | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const folderId = params.folder ?? COMPANY_ROOT_FOLDER_ID;
  const status = useQuery(trpc.file.status.queryOptions());
  const configured = status.data?.configured !== false;

  const setSearch = (next: Partial<FilesSearch>, replace = true) =>
    void navigate({
      search: (prev) => {
        const merged: Record<string, unknown> = { ...prev, ...next };
        for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
        return merged;
      },
      replace,
    });
  const openFolder = (id: string) =>
    setSearch({ folder: id, q: undefined, view: undefined, file: undefined }, false);

  return (
    <div className="min-w-0">
      <PageHeader title={t.title} subtitle={t.subtitle}>
        {canWrite && params.view !== 'trash' ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setDialog({ kind: 'newFolder', parentId: folderId })}
            >
              <FolderPlus className="size-4" aria-hidden />
              {t.newFolder}
            </Button>
            <Button disabled={!configured} onClick={() => picker.current?.click()}>
              <Upload className="size-4" aria-hidden />
              {t.upload}
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              accept={FILE_ACCEPT}
              onChange={(event) => {
                if (event.target.files) uploadFiles([...event.target.files], folderId);
                event.target.value = '';
              }}
            />
          </>
        ) : null}
      </PageHeader>

      <div className="flex max-w-[1440px] flex-wrap items-start gap-5 px-7 pt-5 pb-10">
        <FolderTree
          folderId={folderId}
          trash={params.view === 'trash'}
          onOpen={openFolder}
          onTrash={() => setSearch({ view: 'trash', q: undefined, file: undefined }, false)}
        />
        <div className="min-w-0 flex-[999_1_560px] space-y-4">
          {configured ? null : <StatusBanner tone="warning">{t.notConfigured}</StatusBanner>}
          {params.view === 'trash' ? (
            <TrashSection />
          ) : (
            <ContentsSection
              folderId={folderId}
              params={params}
              setSearch={setSearch}
              onOpenFolder={openFolder}
              onOpenFile={(id) => setSearch({ file: id }, false)}
              onDialog={setDialog}
              onPick={() => picker.current?.click()}
              canUpload={canWrite && configured}
            />
          )}
        </div>
      </div>

      {params.file ? (
        <FileSheet fileId={params.file} onClose={() => setSearch({ file: undefined })} />
      ) : null}
      <FilesDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onFolderDeleted={(deleted, parentId) => {
          if (deleted === folderId) openFolder(parentId);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The tree

type TreeFolder = RouterOutputs['file']['tree']['folders'][number];

function nodeClass(active: boolean) {
  return cn(
    'flex h-[34px] w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-sm font-medium transition-colors',
    active ? 'bg-primary-soft font-semibold text-primary-text' : 'hover:bg-[#f0f8f7]',
  );
}

function TreeHeading({ children }: { children: ReactNode }) {
  return (
    <p className="mx-2.5 mt-3.5 mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-tertiary uppercase">
      {children}
    </p>
  );
}

/** The company's folders, the customers' folders and the trash. */
function FolderTree({
  folderId,
  trash,
  onOpen,
  onTrash,
}: {
  folderId: string;
  trash: boolean;
  onOpen: (id: string) => void;
  onTrash: () => void;
}) {
  const tree = useQuery(trpc.file.tree.queryOptions());
  const [typed, setTyped] = useState('');
  const [all, setAll] = useState(false);
  const customerSearch = useDebounced(typed.trim(), 250);
  const customers = useQuery({
    ...trpc.file.customerFolders.queryOptions({
      search: customerSearch || undefined,
      all,
    }),
    placeholderData: keepPreviousData,
  });

  const children = useMemo(() => {
    const map = new Map<string, TreeFolder[]>();
    for (const folder of tree.data?.folders ?? []) {
      const list = map.get(folder.parentId!) ?? [];
      list.push(folder);
      map.set(folder.parentId!, list);
    }
    return map;
  }, [tree.data]);

  const renderLevel = (parentId: string, depth: number): ReactNode =>
    (children.get(parentId) ?? []).map((folder) => (
      <li key={folder.id}>
        <button
          type="button"
          onClick={() => onOpen(folder.id)}
          aria-current={!trash && folder.id === folderId ? 'page' : undefined}
          className={nodeClass(!trash && folder.id === folderId)}
          style={{ paddingLeft: 10 + depth * 24 }}
        >
          <Folder className="size-4 shrink-0 opacity-80" aria-hidden />
          <span className="truncate">{folder.name}</span>
          {folder.fileCount > 0 ? (
            <span className="ml-auto text-xs font-normal text-tertiary">{folder.fileCount}</span>
          ) : null}
        </button>
        {children.has(folder.id) ? <ul>{renderLevel(folder.id, depth + 1)}</ul> : null}
      </li>
    ));

  return (
    <nav
      aria-label={t.tree.label}
      className="w-full max-w-[280px] min-w-0 flex-[1_1_240px] rounded-2xl border border-border-subtle bg-white px-2 pt-1.5 pb-2.5 shadow-rest"
    >
      <TreeHeading>
        <button
          type="button"
          className="tracking-[0.06em] uppercase hover:text-primary-text"
          onClick={() => onOpen(COMPANY_ROOT_FOLDER_ID)}
        >
          {t.tree.company}
        </button>
      </TreeHeading>
      {tree.isPending ? (
        <p className="px-2.5 py-2 text-sm text-muted">{sk.common.loading}</p>
      ) : (
        <ul>{renderLevel(COMPANY_ROOT_FOLDER_ID, 0)}</ul>
      )}

      <TreeHeading>{t.tree.customers}</TreeHeading>
      <label className="mx-1 mb-1 flex h-8 items-center gap-1.5 rounded-[9px] border border-border-subtle px-2.5 text-[13px] text-tertiary focus-within:border-primary">
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{t.tree.findCustomer}</span>
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={t.tree.findCustomer}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-tertiary"
        />
      </label>
      <ul>
        {(customers.data?.items ?? []).map((customer) => (
          <li key={customer.folderId}>
            <button
              type="button"
              onClick={() => onOpen(customer.folderId)}
              aria-current={!trash && customer.folderId === folderId ? 'page' : undefined}
              className={nodeClass(!trash && customer.folderId === folderId)}
            >
              <Building2 className="size-4 shrink-0 opacity-80" aria-hidden />
              <span className="truncate">{customer.name}</span>
              {customer.fileCount > 0 ? (
                <span className="ml-auto text-xs font-normal text-tertiary">
                  {customer.fileCount}
                </span>
              ) : null}
            </button>
          </li>
        ))}
        {customers.data && customers.data.items.length === 0 ? (
          <li className="px-2.5 py-1.5 text-[13px] text-muted">{t.tree.noCustomer}</li>
        ) : null}
      </ul>
      {customerSearch ? null : (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="flex h-8 w-full items-center rounded-[9px] pl-[34px] text-left text-[13px] font-semibold text-primary-text hover:bg-[#f0f8f7]"
        >
          {all ? t.tree.fewerCustomers : t.tree.allCustomers(customers.data?.total ?? 0)}
        </button>
      )}

      <div className="mx-1 my-2.5 h-px bg-border-subtle" />
      <button
        type="button"
        onClick={onTrash}
        aria-current={trash ? 'page' : undefined}
        className={nodeClass(trash)}
      >
        <Trash2 className="size-4 shrink-0 opacity-80" aria-hidden />
        {t.tree.trash}
        {tree.data && tree.data.trashCount > 0 ? (
          <span className="ml-auto text-xs font-normal text-tertiary">{tree.data.trashCount}</span>
        ) : null}
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------
// A folder

function ContentsSection({
  folderId,
  params,
  setSearch,
  onOpenFolder,
  onOpenFile,
  onDialog,
  onPick,
  canUpload,
}: {
  folderId: string;
  params: FilesSearch;
  setSearch: (next: Partial<FilesSearch>) => void;
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onDialog: (dialog: FilesDialog) => void;
  onPick: () => void;
  canUpload: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCan('file.write');
  const canDelete = useCan('file.delete');
  const [typed, setTyped] = useState(params.q ?? '');
  const debounced = useDebounced(typed.trim(), 300);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    if ((params.q ?? '') !== debounced) setSearch({ q: debounced || undefined });
    // Only the typed text drives this; the address follows it.
  }, [debounced]);
  // Another folder opened from the tree clears the box with the address.
  useEffect(() => {
    if (!params.q) setTyped('');
  }, [params.q]);

  const input = {
    folderId,
    ...(params.q ? { search: params.q } : {}),
    ...(params.group ? { group: params.group } : {}),
    ...(params.by ? { changedBy: params.by } : {}),
    ...(params.period ? { period: params.period } : {}),
  };
  const contents = useQuery({
    ...trpc.file.contents.queryOptions(input),
    placeholderData: keepPreviousData,
  });
  const authors = useQuery(trpc.file.authors.queryOptions());

  const trash = useMutation(
    trpc.file.trashFile.mutationOptions({
      onSuccess: async (_result, variables) => {
        await queryClient.invalidateQueries(trpc.file.pathFilter());
        toast('success', t.trash.trashed, {
          label: t.trash.undo,
          run: async () => {
            await restore.mutateAsync({ id: variables.id });
          },
        });
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const restore = useMutation(
    trpc.file.restoreFile.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.file.pathFilter()),
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );

  const filtered = Boolean(params.group || params.by || params.period);
  const data = contents.data;
  const path = data?.path ?? [];
  const current = path.at(-1);
  const searched = data?.searched ?? false;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (canUpload && event.dataTransfer.files.length > 0) {
      uploadFiles([...event.dataTransfer.files], folderId);
    }
  };
  const dropHandlers = canUpload
    ? {
        onDragEnter: (event: DragEvent) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        },
        onDragOver: (event: DragEvent) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        },
        onDragLeave: () => {
          depth.current -= 1;
          if (depth.current <= 0) setDragging(false);
        },
        onDrop,
      }
    : {};

  if (loadFailed(contents)) {
    return (
      <ErrorState
        text={errorMessage(contents.error, t.errors)}
        onRetry={() => void contents.refetch()}
      />
    );
  }

  const fileMenu = (file: FileRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          className="size-8 border-0 bg-transparent"
          aria-label={t.actionsFor(file.name)}
        >
          <MoreVertical className="size-[18px]" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() =>
            void downloadFile(file.id, file.name).catch((error: unknown) =>
              toast('error', errorMessage(error, t.errors)),
            )
          }
        >
          {t.menu.download}
        </DropdownMenuItem>
        {canPreview(file.name) ? (
          <DropdownMenuItem
            onSelect={() =>
              void previewFile(file.id).catch((error: unknown) =>
                toast('error', errorMessage(error, t.errors)),
              )
            }
          >
            {t.menu.preview}
          </DropdownMenuItem>
        ) : null}
        {canWrite ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDialog({ kind: 'version', file })}>
              {t.menu.newVersion}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDialog({ kind: 'renameFile', file })}>
              {t.menu.rename}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDialog({ kind: 'moveFile', file })}>
              {t.menu.move}
            </DropdownMenuItem>
          </>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => trash.mutate({ id: file.id })}>
              {t.menu.trash}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const rows = (
    <>
      {(data?.folders ?? []).map((folder) => {
        const ref = { id: folder.id, name: folder.name, parentId: folderId };
        return (
          <TableRow key={folder.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <FolderTile />
                <button
                  type="button"
                  className="truncate font-semibold hover:text-primary-text hover:underline"
                  onClick={() => onOpenFolder(folder.id)}
                >
                  {folder.name}
                </button>
              </div>
            </TableCell>
            <TableCell className="text-muted">{formatDate(folder.updatedAt)}</TableCell>
            <TableCell className="text-muted">{sk.common.none}</TableCell>
            <TableCell className="text-muted">{t.folderFiles(folder.fileCount)}</TableCell>
            <TableCell />
            <TableCell className="text-right">
              {canWrite || canDelete ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      className="size-8 border-0 bg-transparent"
                      aria-label={t.actionsFor(folder.name)}
                    >
                      <MoreVertical className="size-[18px]" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canWrite ? (
                      <>
                        <DropdownMenuItem
                          onSelect={() => onDialog({ kind: 'renameFolder', folder: ref })}
                        >
                          {t.menu.renameFolder}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => onDialog({ kind: 'moveFolder', folder: ref })}
                        >
                          {t.menu.moveFolder}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {canDelete ? (
                      <DropdownMenuItem
                        destructive
                        onSelect={() => onDialog({ kind: 'deleteFolder', folder: ref })}
                      >
                        {t.menu.deleteFolder}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </TableCell>
          </TableRow>
        );
      })}
      {(data?.files ?? []).map((file) => (
        <TableRow key={file.id}>
          <TableCell>
            <div className="flex min-w-0 items-center gap-3">
              <FileBadge name={file.name} />
              <div className="min-w-0">
                <button
                  type="button"
                  className="max-w-[28rem] truncate text-left font-semibold hover:text-primary-text hover:underline"
                  onClick={() => onOpenFile(file.id)}
                >
                  {file.name}
                </button>
                {searched ? (
                  <button
                    type="button"
                    className="block text-xs text-muted hover:text-primary-text hover:underline"
                    onClick={() => onOpenFolder(file.folderId)}
                  >
                    {file.folderName}
                  </button>
                ) : null}
              </div>
            </div>
          </TableCell>
          <TableCell className="text-muted">{formatRecent(file.changedAt)}</TableCell>
          <TableCell className="text-muted">
            <ChangedBy name={file.changedBy} via={file.changedVia} />
          </TableCell>
          <TableCell className="text-muted">{formatSize(file.size)}</TableCell>
          <TableCell>
            <span className="inline-flex h-[22px] items-center rounded-md border border-border-subtle bg-surface px-2 text-xs font-semibold text-muted">
              v{file.version}
            </span>
          </TableCell>
          <TableCell className="text-right">{fileMenu(file)}</TableCell>
        </TableRow>
      ))}
    </>
  );

  const empty = data && data.folders.length === 0 && data.files.length === 0;
  const message = !empty ? null : searched ? t.searchResults(0) : filtered ? t.emptyFiltered : null;

  return (
    <section
      {...dropHandlers}
      className={cn(
        'relative min-w-0 overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-rest',
        dragging && 'ring-2 ring-primary',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-5 pt-[18px] pb-4">
        <div className="min-w-0 flex-[1_1_260px]">
          {searched ? (
            <>
              <p className="text-[13px] font-medium text-muted">
                {t.searchResults(data?.files.length ?? 0)}
              </p>
              <h2 className="text-[19px] leading-6 font-bold">{t.searchTitle}</h2>
            </>
          ) : (
            <>
              <nav aria-label={t.breadcrumb} className="text-[13px] font-medium text-muted">
                {path.slice(0, -1).map((step) => (
                  <span key={step.id}>
                    <button
                      type="button"
                      className="text-primary-text hover:underline"
                      onClick={() => onOpenFolder(step.id)}
                    >
                      {step.name}
                    </button>{' '}
                    <span aria-hidden>/</span>{' '}
                  </span>
                ))}
              </nav>
              <h2 className="mt-0.5 text-[19px] leading-6 font-bold">
                {current?.name ?? sk.common.loading}
              </h2>
            </>
          )}
        </div>
        <label className="flex h-9 flex-[0_1_280px] items-center gap-2 rounded-[10px] border border-border px-3 focus-within:border-primary">
          <Search className="size-[15px] shrink-0 text-tertiary" aria-hidden />
          <span className="sr-only">{t.searchLabel}</span>
          <input
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={t.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-tertiary"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 px-5 pb-3">
        <FilterMenu
          label={t.filters.group}
          value={params.group}
          options={FILE_GROUPS.map((value) => ({ value, label: t.groups[value] }))}
          onChange={(group) => setSearch({ group })}
        />
        <FilterMenu
          label={t.filters.changedBy}
          value={params.by}
          options={(authors.data ?? []).map((user) => ({ value: user.id, label: user.name }))}
          onChange={(by) => setSearch({ by })}
        />
        <FilterMenu
          label={t.filters.period}
          value={params.period}
          options={FILE_PERIODS.map((value) => ({ value, label: t.periods[value] }))}
          onChange={(period) => setSearch({ period })}
        />
      </div>

      {empty && !message ? (
        <EmptyState
          compact
          title={t.empty}
          text={canUpload ? t.emptyText : undefined}
          className="border-t border-border-subtle"
        />
      ) : (
        <TableShell
          className="rounded-none border-0 shadow-none"
          columns={[
            t.columns.name,
            t.columns.changed,
            t.columns.changedBy,
            t.columns.size,
            t.columns.version,
            <span key="actions" className="sr-only">
              {t.columns.actions}
            </span>,
          ]}
          loading={contents.isPending}
          refreshing={contents.isPlaceholderData}
          message={message}
        >
          {rows}
        </TableShell>
      )}

      {canUpload && !searched ? (
        <div className="mx-5 mt-4 mb-5 flex items-center justify-center gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-[#c5d3d1] p-[18px] text-sm text-muted">
          <Upload className="size-[18px] shrink-0" aria-hidden />
          {dragging ? (
            <span>{t.dropzone.over}</span>
          ) : (
            <span>
              {t.dropzone.before}
              <button
                type="button"
                className="font-semibold text-primary-text hover:underline"
                onClick={onPick}
              >
                {t.dropzone.pick}
              </button>
              {t.dropzone.after}
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The trash

function TrashSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canDelete = useCan('file.delete');
  const trash = useQuery(trpc.file.trash.queryOptions());
  const restore = useMutation(
    trpc.file.restoreFile.mutationOptions({
      onSuccess: async () => {
        toast('success', t.trash.restored);
        await queryClient.invalidateQueries(trpc.file.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const rows = trash.data ?? [];
  return (
    <TableShell
      header={
        <div className="px-5 pt-[18px]">
          <h2 className="text-[19px] leading-6 font-bold">{t.trash.title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{t.trash.lead}</p>
        </div>
      }
      columns={[
        t.trash.columns.name,
        t.trash.columns.folder,
        t.trash.columns.deleted,
        t.trash.columns.purge,
        <span key="actions" className="sr-only">
          {t.trash.columns.actions}
        </span>,
      ]}
      loading={trash.isPending}
      message={
        loadFailed(trash)
          ? errorMessage(trash.error, t.errors)
          : rows.length === 0
            ? t.trash.empty
            : null
      }
    >
      {rows.map((file) => (
        <TableRow key={file.id}>
          <TableCell>
            <div className="flex min-w-0 items-center gap-3">
              <FileBadge name={file.name} />
              <span className="truncate font-semibold">{file.name}</span>
            </div>
          </TableCell>
          <TableCell className="text-muted">
            <Link
              to="/files"
              search={{ folder: file.folderId }}
              className="text-primary-text hover:underline"
            >
              {file.folderName}
            </Link>
          </TableCell>
          <TableCell className="text-muted">
            {t.trash.by(formatDate(file.deletedAt), file.deletedBy ?? sk.common.none)}
          </TableCell>
          <TableCell className="text-muted">{formatDate(file.purgeAt)}</TableCell>
          <TableCell className="text-right">
            {canDelete ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={restore.isPending}
                onClick={() => restore.mutate({ id: file.id })}
              >
                {t.trash.restore}
              </Button>
            ) : null}
          </TableCell>
        </TableRow>
      ))}
    </TableShell>
  );
}
