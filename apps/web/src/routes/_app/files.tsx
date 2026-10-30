import { sk } from '@intra/shared/i18n';
import {
  COMPANY_ROOT_FOLDER_ID,
  FILE_ACCEPT,
  FILE_GROUPS,
  FILE_PERIODS,
  FILE_TYPES,
  fileExtension,
  isoDateSchema,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  Building2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderPlus,
  MoreVertical,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import { FilterMenu } from '@/components/customers/customer-bits';
import { ChangedBy, FileBadge, FolderTile } from '@/components/files/file-bits';
import { type FilesDialog, FilesDialogs } from '@/components/files/file-dialogs';
import { FileSheet } from '@/components/files/file-sheet';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { TableShell } from '@/components/table-shell';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusBanner } from '@/components/ui/status-banner';
import { CELL_LINK, TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { canPreview, formatSize } from '@/lib/files';
import { formatDate, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc, trpcClient } from '@/lib/trpc';
import { downloadFile, previewFile, uploadFiles } from '@/lib/uploads';
import { cn } from '@/lib/utils';

const t = sk.files;

const search = z.object({
  folder: z.string().uuid().optional(),
  q: z.string().optional(),
  group: z.enum(FILE_GROUPS).optional(),
  by: z.string().uuid().optional(),
  period: z.enum(FILE_PERIODS).optional(),
  /** The document's date, from and to. */
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
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
                if (event.target.files) void uploadFiles([...event.target.files], folderId);
                event.target.value = '';
              }}
            />
          </>
        ) : null}
      </PageHeader>

      <div className="flex flex-col items-stretch gap-5 px-7 pt-5 pb-10 md:flex-row md:items-start">
        <FolderTree
          folderId={folderId}
          trash={params.view === 'trash'}
          onOpen={openFolder}
          onTrash={() => setSearch({ view: 'trash', q: undefined, file: undefined }, false)}
        />
        <div className="min-w-0 flex-1 space-y-4">
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

/** Indent of one level of the tree: small, so four levels still show their names. */
const INDENT = 14;
const TREE_WIDTH = { initial: 260, min: 200, max: 560 } as const;
const WIDTH_KEY = 'intra.files.treeWidth';
const OPEN_KEY = 'intra.files.openFolders';

/** Lower case without diacritics, so „zmluvy“ finds „Zmluvy a podmienky“ and „Zúčtovanie“ „zuct“. */
const folded = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A blocked storage only forgets the width and the open folders.
  }
}

/** The tree's width, dragged at its right edge and remembered in this browser. */
function useTreeWidth() {
  const [width, setWidth] = useState(() => {
    const value = stored<number>(WIDTH_KEY, TREE_WIDTH.initial);
    return Math.min(TREE_WIDTH.max, Math.max(TREE_WIDTH.min, value));
  });
  const clamp = (value: number) => Math.min(TREE_WIDTH.max, Math.max(TREE_WIDTH.min, value));
  const startDrag = (event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let last = startWidth;
    const move = (e: PointerEvent) => {
      last = clamp(startWidth + e.clientX - startX);
      setWidth(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      store(WIDTH_KEY, last);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudge = (by: number) => {
    const next = clamp(width + by);
    setWidth(next);
    store(WIDTH_KEY, next);
  };
  return { width, startDrag, nudge };
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
  const { width, startDrag, nudge } = useTreeWidth();
  const [typed, setTyped] = useState('');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(stored<string[]>(OPEN_KEY, [])));
  const query = typed.trim();
  const customerSearch = useDebounced(query, 250);
  const customers = useQuery({
    ...trpc.file.customerFolders.queryOptions({
      search: customerSearch || undefined,
      all,
    }),
    placeholderData: keepPreviousData,
  });

  const { children, parentOf } = useMemo(() => {
    const map = new Map<string, TreeFolder[]>();
    const parents = new Map<string, string>();
    for (const folder of tree.data?.folders ?? []) {
      const list = map.get(folder.parentId!) ?? [];
      list.push(folder);
      map.set(folder.parentId!, list);
      parents.set(folder.id, folder.parentId!);
    }
    return { children: map, parentOf: parents };
  }, [tree.data]);

  const setOpenFolders = (next: Set<string>) => {
    setOpen(next);
    store(OPEN_KEY, [...next]);
  };
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenFolders(next);
  };

  // The open folder's ancestors open with it, so the tree always shows where one is.
  useEffect(() => {
    const missing: string[] = [];
    for (let id = parentOf.get(folderId); id && id !== COMPANY_ROOT_FOLDER_ID;) {
      if (!open.has(id)) missing.push(id);
      id = parentOf.get(id);
    }
    if (missing.length > 0) setOpenFolders(new Set([...open, ...missing]));
    // Only a new folder or a reloaded tree asks for this.
  }, [folderId, parentOf]);

  /** While searching: the folders whose name matches, and their ancestors to reach them. */
  const shown = useMemo(() => {
    if (!query) return null;
    const needle = folded(query);
    const keep = new Set<string>();
    for (const folder of tree.data?.folders ?? []) {
      if (!folded(folder.name).includes(needle)) continue;
      for (let id: string | undefined = folder.id; id && !keep.has(id); id = parentOf.get(id)) {
        keep.add(id);
      }
    }
    return keep;
  }, [query, tree.data, parentOf]);

  const renderLevel = (parentId: string, depth: number): ReactNode =>
    (children.get(parentId) ?? [])
      .filter((folder) => !shown || shown.has(folder.id))
      .map((folder) => {
        const active = !trash && folder.id === folderId;
        const hasChildren = children.has(folder.id);
        const expanded = hasChildren && (shown !== null || open.has(folder.id));
        return (
          <li key={folder.id}>
            <div
              className={cn(nodeClass(active), 'gap-1 px-0 pr-2')}
              style={{ paddingLeft: 4 + depth * INDENT }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={expanded ? t.tree.collapse(folder.name) : t.tree.expand(folder.name)}
                  onClick={() => toggle(folder.id)}
                  disabled={shown !== null}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded text-tertiary hover:text-foreground disabled:opacity-60"
                >
                  <ChevronRight
                    className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
                    aria-hidden
                  />
                </button>
              ) : (
                <span className="size-5 shrink-0" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => onOpen(folder.id)}
                aria-current={active ? 'page' : undefined}
                title={folder.name}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <Folder className="size-4 shrink-0 opacity-80" aria-hidden />
                <span className="truncate">{folder.name}</span>
                {folder.fileCount > 0 ? (
                  <span className="ml-auto pl-1 text-xs font-normal text-tertiary">
                    {folder.fileCount}
                  </span>
                ) : null}
              </button>
            </div>
            {expanded ? <ul>{renderLevel(folder.id, depth + 1)}</ul> : null}
          </li>
        );
      });

  const companyLevel = tree.isPending ? null : renderLevel(COMPANY_ROOT_FOLDER_ID, 0);
  const iconButton =
    'inline-flex size-6 items-center justify-center rounded-md text-tertiary hover:bg-[#f0f8f7] hover:text-foreground';

  return (
    <nav
      aria-label={t.tree.label}
      className="relative w-full min-w-0 shrink-0 rounded-2xl border border-border-subtle bg-white px-2 pt-2 pb-2.5 shadow-rest md:w-[var(--tree-width)]"
      style={{ '--tree-width': `${width}px` } as CSSProperties}
    >
      <label className="mx-1 flex h-8 items-center gap-1.5 rounded-[9px] border border-border-subtle px-2.5 text-[13px] text-tertiary focus-within:border-primary">
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{t.tree.findFolder}</span>
        <input
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={t.tree.findFolder}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-tertiary"
        />
      </label>

      <div className="flex items-center gap-1 pr-1">
        <TreeHeading>
          <button
            type="button"
            className="tracking-[0.06em] uppercase hover:text-primary-text"
            onClick={() => onOpen(COMPANY_ROOT_FOLDER_ID)}
          >
            {t.tree.company}
          </button>
        </TreeHeading>
        <span className="ml-auto mt-2 flex">
          <button
            type="button"
            aria-label={t.tree.expandAll}
            title={t.tree.expandAll}
            className={iconButton}
            onClick={() => setOpenFolders(new Set(children.keys()))}
          >
            <ChevronsUpDown className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t.tree.collapseAll}
            title={t.tree.collapseAll}
            className={iconButton}
            onClick={() => setOpenFolders(new Set())}
          >
            <ChevronsDownUp className="size-3.5" aria-hidden />
          </button>
        </span>
      </div>
      {tree.isPending ? (
        <p className="px-2.5 py-2 text-sm text-muted">{sk.common.loading}</p>
      ) : shown && shown.size === 0 ? (
        <p className="px-2.5 py-1.5 text-[13px] text-muted">{t.tree.noFolder}</p>
      ) : (
        <ul>{companyLevel}</ul>
      )}

      <TreeHeading>{t.tree.customers}</TreeHeading>
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
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t.tree.resize}
        aria-valuenow={width}
        aria-valuemin={TREE_WIDTH.min}
        aria-valuemax={TREE_WIDTH.max}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') nudge(-20);
          if (event.key === 'ArrowRight') nudge(20);
        }}
        className="absolute top-3 -right-3 bottom-3 hidden w-3 cursor-col-resize items-center justify-center outline-none md:flex [&:hover>span]:bg-primary [&:focus-visible>span]:bg-primary"
      >
        <span className="h-10 w-1 rounded-full bg-border transition-colors" aria-hidden />
      </div>
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
  const searchBox = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<FileRow | null>(null);
  const [dragged, setDragged] = useState<DragItem | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ item: DragItem; target: FolderRef } | null>(null);

  /** A row dragged within the list, onto a folder's row (not a file from the computer). */
  const dragFrom = (item: DragItem) =>
    canWrite
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.setData(ITEM_TYPE, item.id);
            event.dataTransfer.effectAllowed = 'copyMove';
            setDragged(item);
          },
          onDragEnd: () => {
            setDragged(null);
            setOver(null);
          },
        }
      : {};
  const dropOn = (target: FolderRef) =>
    canWrite
      ? {
          onDragOver: (event: DragEvent) => {
            if (!dragged || dragged.id === target.id) return;
            if (!event.dataTransfer.types.includes(ITEM_TYPE)) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(target.id);
          },
          onDragLeave: () => setOver((id) => (id === target.id ? null : id)),
          onDrop: (event: DragEvent) => {
            if (!dragged || dragged.id === target.id) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(null);
            setDrop({ item: dragged, target });
            setDragged(null);
          },
        }
      : {};

  // Opening „Súbory“ puts the cursor in the search, so one can type straight away.
  useEffect(() => {
    if (!params.file) searchBox.current?.focus({ preventScroll: true });
    // Only on arrival, never while one works in the page.
  }, []);

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
    ...(params.from ? { dateFrom: params.from } : {}),
    ...(params.to ? { dateTo: params.to } : {}),
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

  const filtered = Boolean(params.group || params.by || params.period || params.from || params.to);
  const data = contents.data;
  const path = data?.path ?? [];
  const current = path.at(-1);
  const searched = data?.searched ?? false;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (canUpload && event.dataTransfer.files.length > 0) {
      void uploadFiles([...event.dataTransfer.files], folderId);
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

  /** A click on a file: a photo shows here, a PDF in a new tab, anything else its detail. */
  const openFile = (file: FileRow) => {
    const ext = fileExtension(file.name);
    if (ext && FILE_TYPES[ext].group === 'image' && FILE_TYPES[ext].preview) {
      setPhoto(file);
    } else if (canPreview(file.name)) {
      void previewFile(file.id).catch((error: unknown) =>
        toast('error', errorMessage(error, t.errors)),
      );
    } else {
      onOpenFile(file.id);
    }
  };

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
          <TableRow
            key={folder.id}
            onClick={() => onOpenFolder(folder.id)}
            {...dragFrom({ kind: 'folder', id: folder.id, name: folder.name })}
            {...dropOn({ id: folder.id, name: folder.name })}
            className={cn(
              over === folder.id && 'bg-primary-soft outline-2 -outline-offset-2 outline-primary',
              dragged?.id === folder.id && 'opacity-50',
            )}
          >
            <TableCell>
              <div className="flex items-center gap-3">
                <FolderTile />
                <button
                  type="button"
                  className="truncate text-[15px] font-semibold hover:text-primary-text hover:underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenFolder(folder.id);
                  }}
                >
                  {folder.name}
                </button>
              </div>
            </TableCell>
            <TableCell className="text-xs leading-[18px] text-tertiary">
              {t.changedLine(formatDate(folder.updatedAt))}
            </TableCell>
            <TableCell className="text-xs whitespace-nowrap text-tertiary">
              {t.folderFiles(folder.fileCount)}
            </TableCell>
            <TableCell />
            <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
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
        <TableRow
          key={file.id}
          onClick={() => openFile(file)}
          {...dragFrom({ kind: 'file', id: file.id, name: file.name })}
          className={cn(dragged?.id === file.id && 'opacity-50')}
        >
          <TableCell>
            <div className="flex min-w-0 items-center gap-3">
              <FileBadge name={file.name} />
              <div className="min-w-0">
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-[15px] font-semibold hover:text-primary-text hover:underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    openFile(file);
                  }}
                >
                  {file.name}
                </button>
                {searched ? (
                  <button
                    type="button"
                    className="block text-left text-xs text-muted hover:text-primary-text hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenFolder(file.folderId);
                    }}
                  >
                    {file.folderPath ?? file.folderName}
                  </button>
                ) : null}
              </div>
            </div>
          </TableCell>
          <TableCell className="text-xs leading-[18px] whitespace-nowrap text-tertiary">
            <p>{t.dateLine(file.documentDate ? formatDate(file.documentDate) : sk.common.none)}</p>
            <p>
              {t.changedLine(formatRecent(file.changedAt))} ·{' '}
              <ChangedBy name={file.changedBy} via={file.changedVia} />
            </p>
          </TableCell>
          <TableCell className="text-xs whitespace-nowrap text-tertiary">
            {formatSize(file.size)}
          </TableCell>
          <TableCell>
            <button
              type="button"
              aria-label={t.detailOf(file.name)}
              title={t.detailOf(file.name)}
              onClick={(event) => {
                event.stopPropagation();
                onOpenFile(file.id);
              }}
              className="inline-flex h-[22px] items-center rounded-md border border-border-subtle bg-surface px-2 text-xs font-semibold text-muted hover:border-primary hover:text-primary-text"
            >
              v{file.version}
            </button>
          </TableCell>
          <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
            {fileMenu(file)}
          </TableCell>
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
      <div className="px-5 pt-[18px] pb-3">
        <div className="min-w-0">
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
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <label className="flex h-9 min-w-[220px] flex-[0_1_320px] items-center gap-2 rounded-[10px] border border-border px-3 focus-within:border-primary">
          <Search className="size-[15px] shrink-0 text-tertiary" aria-hidden />
          <span className="sr-only">{t.searchLabel}</span>
          <input
            ref={searchBox}
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={t.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-tertiary"
          />
        </label>
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
        <label
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-[10px] border border-border bg-white px-3 text-[13px] font-medium',
            (params.from || params.to) && 'border-primary text-primary-text',
          )}
        >
          {t.filters.dateFrom}
          <DatePicker
            inline
            label={t.filters.dateFrom}
            value={params.from ?? ''}
            max={params.to}
            onChange={(value) => setSearch({ from: value || undefined })}
          />
        </label>
        <label
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-[10px] border border-border bg-white px-3 text-[13px] font-medium',
            (params.from || params.to) && 'border-primary text-primary-text',
          )}
        >
          {t.filters.dateTo}
          <DatePicker
            inline
            label={t.filters.dateTo}
            value={params.to ?? ''}
            min={params.from}
            onChange={(value) => setSearch({ to: value || undefined })}
          />
        </label>
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
            t.columns.dates,
            t.columns.size,
            t.columns.version,
            <span key="actions" className="sr-only">
              {t.columns.actions}
            </span>,
          ]}
          columnClassNames={['w-1/2']}
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
      <DropDialog drop={drop} onClose={() => setDrop(null)} />
      <PhotoViewer
        file={photo}
        onClose={() => setPhoto(null)}
        onDetail={(id) => {
          setPhoto(null);
          onOpenFile(id);
        }}
      />
    </section>
  );
}

const ITEM_TYPE = 'application/x-intra-item';
type DragItem = { kind: 'file' | 'folder'; id: string; name: string };
type FolderRef = { id: string; name: string };

/** After a row was dropped on a folder: move it, copy it, or leave it. */
function DropDialog({
  drop,
  onClose,
}: {
  drop: { item: DragItem; target: FolderRef } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const done = (message: string) => async () => {
    onClose();
    toast('success', message);
    await queryClient.invalidateQueries(trpc.file.pathFilter());
  };
  const onError = (error: unknown) => toast('error', errorMessage(error, t.errors));
  const moved = { onSuccess: done(t.drop.moved), onError };
  const copied = { onSuccess: done(t.drop.copied), onError };
  const moveFile = useMutation(trpc.file.move.mutationOptions(moved));
  const moveFolder = useMutation(trpc.file.moveFolder.mutationOptions(moved));
  const copyFile = useMutation(trpc.file.copyFile.mutationOptions(copied));
  const copyFolder = useMutation(trpc.file.copyFolder.mutationOptions(copied));
  const busy = [moveFile, moveFolder, copyFile, copyFolder].some((m) => m.isPending);

  const run = (action: 'move' | 'copy') => {
    if (!drop) return;
    const { item, target } = drop;
    if (item.kind === 'file') {
      const input = { id: item.id, folderId: target.id };
      if (action === 'move') moveFile.mutate(input);
      else copyFile.mutate(input);
    } else {
      const input = { id: item.id, parentId: target.id };
      if (action === 'move') moveFolder.mutate(input);
      else copyFolder.mutate(input);
    }
  };

  return (
    <Dialog open={drop !== null} onOpenChange={(open) => (open || busy ? null : onClose())}>
      <DialogContent>
        <DialogTitle className="pr-10">
          {drop ? t.drop.title(drop.item.name, drop.target.name) : null}
        </DialogTitle>
        <DialogDescription>{t.drop.text}</DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => run('copy')}>
            {t.drop.copy}
          </Button>
          <Button disabled={busy} onClick={() => run('move')}>
            {t.drop.move}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A photo shown in the page, over the list: its name, the picture, and a way to its detail. */
function PhotoViewer({
  file,
  onClose,
  onDetail,
}: {
  file: FileRow | null;
  onClose: () => void;
  onDetail: (id: string) => void;
}) {
  const url = useQuery({
    queryKey: ['file-photo', file?.id, file?.version],
    queryFn: () => trpcClient.file.download.mutate({ id: file!.id, inline: true }),
    enabled: file !== null,
    staleTime: 4 * 60_000,
  });
  return (
    <Dialog open={file !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent size="lg" className="gap-3">
        <DialogTitle className="truncate pr-10">{file?.name}</DialogTitle>
        <DialogDescription className="sr-only">{file?.name}</DialogDescription>
        <div className="flex min-h-[40vh] items-center justify-center rounded-xl bg-surface">
          {url.data ? (
            <img
              src={url.data.url}
              alt={file?.name ?? ''}
              className="max-h-[75vh] max-w-full rounded-lg object-contain"
            />
          ) : (
            <p className="text-sm text-muted">{url.isError ? t.imageFailed : t.imageLoading}</p>
          )}
        </div>
        {file ? (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => onDetail(file.id)}>
              {t.detailOf(file.name)}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
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
            <Link to="/files" search={{ folder: file.folderId }} className={CELL_LINK}>
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
