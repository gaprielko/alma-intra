import { sk } from '@intra/shared/i18n';
import type { CodeList } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { ErrorState } from '@/components/empty-state';
import { TableShell } from '@/components/table-shell';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { loadFailed } from '@/lib/query-view';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.codeLists;
type Section = CodeList | 'tags';
const SECTIONS: readonly Section[] = ['customer_type', 'source', 'template_category', 'tags'];

export const Route = createFileRoute('/_app/settings/code-lists')({
  validateSearch: z.object({
    list: z.enum(['customer_type', 'source', 'template_category', 'tags']).optional(),
  }),
  component: CodeListsPage,
});

/** Settings › Číselníky: the lists on the left, the chosen one on the right. */
function CodeListsPage() {
  const { list = 'customer_type' } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const types = useQuery(trpc.codeList.list.queryOptions({ list: 'customer_type' }));
  const sources = useQuery(trpc.codeList.list.queryOptions({ list: 'source' }));
  const categories = useQuery(trpc.codeList.list.queryOptions({ list: 'template_category' }));
  const tags = useQuery(trpc.codeList.tags.queryOptions());
  const count = {
    customer_type: types.data?.items.length,
    source: sources.data?.items.length,
    template_category: categories.data?.items.length,
    tags: tags.data?.length,
  };
  return (
    <div className="grid items-start gap-5 px-7 py-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label={t.title} className="flex gap-1 lg:flex-col">
        {SECTIONS.map((key) => (
          <button
            key={key}
            type="button"
            aria-current={list === key ? 'page' : undefined}
            onClick={() => void navigate({ search: { list: key }, replace: true })}
            className={cn(
              'flex h-10 items-center justify-between gap-3 rounded-[10px] px-3 text-left text-sm font-medium transition-colors',
              list === key ? 'bg-primary-soft font-semibold text-primary-text' : 'hover:bg-hover',
            )}
          >
            {t.lists[key]}
            {count[key] !== undefined ? (
              <span className="text-xs text-muted">{count[key]}</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="min-w-0 space-y-4">
        <div>
          <h2 className="text-[17px] leading-[22px] font-semibold">{t.lists[list]}</h2>
          <p className="mt-1 max-w-[44rem] text-sm text-muted">{t.leads[list]}</p>
        </div>
        {list === 'tags' ? <TagsTable /> : <ItemsTable key={list} list={list} />}
      </div>
    </div>
  );
}

function ItemsTable({ list }: { list: CodeList }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const items = useQuery(trpc.codeList.list.queryOptions({ list }));
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string; active: boolean } | null>(
    null,
  );
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries(trpc.codeList.pathFilter());
    await queryClient.invalidateQueries(trpc.customer.options.pathFilter());
  };
  const onError = (error: unknown) => toast('error', errorMessage(error, t.errors));
  const create = useMutation(
    trpc.codeList.create.mutationOptions({
      onSuccess: async () => {
        setName('');
        toast('success', t.added);
        await refresh();
      },
      onError,
    }),
  );
  const update = useMutation(
    trpc.codeList.update.mutationOptions({
      onSuccess: async () => {
        setRenaming(null);
        toast('success', t.saved);
        await refresh();
      },
      onError,
    }),
  );
  const reorder = useMutation(
    trpc.codeList.reorder.mutationOptions({ onSuccess: refresh, onError }),
  );
  const remove = useMutation(
    trpc.codeList.delete.mutationOptions({
      onSuccess: async () => {
        setRemoving(null);
        toast('success', t.removed);
        await refresh();
      },
      onError,
    }),
  );

  const rows = items.data?.items ?? [];
  const move = (index: number, by: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    reorder.mutate({ list, ids });
  };

  return (
    <>
      <TableShell
        columns={[
          t.columns.order,
          t.columns.name,
          list === 'template_category' ? t.columns.templates : t.columns.customers,
          t.columns.offered,
          <span key="a" className="sr-only">
            {t.columns.actions}
          </span>,
        ]}
        columnClassNames={['w-24', undefined, 'w-32', 'w-48', 'w-28']}
        loading={items.isPending}
        message={loadFailed(items) ? <ErrorState onRetry={() => void items.refetch()} /> : null}
        footer={
          <form
            className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-5 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) create.mutate({ list, name: name.trim() });
            }}
          >
            <Label htmlFor={`new-${list}`} className="sr-only">
              {t.newItem[list]}
            </Label>
            <Input
              id={`new-${list}`}
              className="max-w-sm"
              maxLength={80}
              placeholder={t.newPlaceholder[list]}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!name.trim() || create.isPending}>
              <Plus className="size-4" aria-hidden />
              {t.add[list]}
            </Button>
          </form>
        }
      >
        {rows.map((row, index) => (
          <TableRow key={row.id}>
            <TableCell>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  className="size-8"
                  aria-label={t.moveUp(row.name)}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  className="size-8"
                  aria-label={t.moveDown(row.name)}
                  disabled={index === rows.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
              </div>
            </TableCell>
            <TableCell className={cn('font-medium', !row.active && 'text-muted')}>
              {row.name}
            </TableCell>
            <TableCell className="text-muted tabular-nums">{row.customers}</TableCell>
            <TableCell>
              <Switch
                checked={row.active}
                label={t.offeredLabel(row.name)}
                disabled={update.isPending}
                onChange={() =>
                  update.mutate({ list, id: row.id, name: row.name, active: !row.active })
                }
              />
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  size="icon"
                  className="size-8"
                  aria-label={`${t.rename} ${row.name}`}
                  onClick={() => setRenaming({ id: row.id, name: row.name, active: row.active })}
                >
                  <Pencil className="size-3.5" aria-hidden />
                </Button>
                <Tooltip text={row.customers > 0 ? t.removeInUse : t.remove}>
                  <span>
                    <Button
                      size="icon"
                      className="size-8"
                      aria-label={`${t.remove} ${row.name}`}
                      disabled={row.customers > 0}
                      onClick={() => setRemoving({ id: row.id, name: row.name })}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </span>
                </Tooltip>
              </div>
            </TableCell>
          </TableRow>
        ))}
        {list === 'customer_type' && items.data ? (
          <TableRow>
            <TableCell />
            <TableCell colSpan={4} className="text-sm text-muted italic">
              {t.noType(items.data.withoutCount)}
            </TableCell>
          </TableRow>
        ) : null}
      </TableShell>
      {renaming ? (
        <RenameDialog
          name={renaming.name}
          pending={update.isPending}
          onClose={() => setRenaming(null)}
          onSave={(next) =>
            update.mutate({ list, id: renaming.id, name: next, active: renaming.active })
          }
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={`${t.remove} ${removing.name}?`}
          description={t.leads[list]}
          confirmLabel={t.remove}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ list, id: removing.id })}
        />
      ) : null}
    </>
  );
}

function TagsTable() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const tags = useQuery(trpc.codeList.tags.queryOptions());
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries(trpc.codeList.pathFilter());
    await queryClient.invalidateQueries(trpc.customer.pathFilter());
  };
  const onError = (error: unknown) => toast('error', errorMessage(error, t.errors));
  const rename = useMutation(
    trpc.codeList.tagRename.mutationOptions({
      onSuccess: async () => {
        setRenaming(null);
        toast('success', t.saved);
        await refresh();
      },
      onError,
    }),
  );
  const remove = useMutation(
    trpc.codeList.tagDelete.mutationOptions({
      onSuccess: async () => {
        setRemoving(null);
        toast('success', t.removed);
        await refresh();
      },
      onError,
    }),
  );
  return (
    <>
      <TableShell
        columns={[
          t.columns.name,
          t.columns.customers,
          <span key="a" className="sr-only">
            {t.columns.actions}
          </span>,
        ]}
        columnClassNames={[undefined, 'w-32', 'w-28']}
        loading={tags.isPending}
        message={
          loadFailed(tags) ? (
            <ErrorState onRetry={() => void tags.refetch()} />
          ) : tags.data?.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t.emptyTags}</p>
          ) : null
        }
      >
        {tags.data?.map((tag) => (
          <TableRow key={tag.id}>
            <TableCell className="font-medium">{tag.name}</TableCell>
            <TableCell className="text-muted tabular-nums">{tag.customers}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  size="icon"
                  className="size-8"
                  aria-label={`${t.rename} ${tag.name}`}
                  onClick={() => setRenaming(tag)}
                >
                  <Pencil className="size-3.5" aria-hidden />
                </Button>
                <Tooltip text={tag.customers > 0 ? t.errors.IN_USE : t.remove}>
                  <span>
                    <Button
                      size="icon"
                      className="size-8"
                      aria-label={`${t.remove} ${tag.name}`}
                      disabled={tag.customers > 0}
                      onClick={() => setRemoving(tag)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </span>
                </Tooltip>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableShell>
      {renaming ? (
        <RenameDialog
          name={renaming.name}
          pending={rename.isPending}
          onClose={() => setRenaming(null)}
          onSave={(name) => rename.mutate({ id: renaming.id, name })}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={`${t.remove} ${removing.name}?`}
          description={t.leads.tags}
          confirmLabel={t.remove}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ id: removing.id })}
        />
      ) : null}
    </>
  );
}

function RenameDialog({
  name,
  pending,
  onClose,
  onSave,
}: {
  name: string;
  pending: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.renameDialog.title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) onSave(value.trim());
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="rename-item">{t.renameDialog.field}</Label>
            <Input
              id="rename-item"
              autoFocus
              maxLength={80}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={pending || !value.trim()}>
              {sk.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
