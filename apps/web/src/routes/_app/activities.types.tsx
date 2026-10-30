import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ActivitiesHeader } from '@/components/activities/activities-header';
import { ErrorState } from '@/components/empty-state';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import {
  RowActions,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/activities/types')({ component: TypesPage });

const t = sk.activityTypes;
type ActivityType = RouterOutputs['activityType']['list'][number];

/** Typy aktivít: the code list a button in an e-mail records from (docs/activity-types.md). */
function TypesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const types = useQuery(trpc.activityType.list.queryOptions());
  const canWrite = useCan('activity_type.write');
  const [editing, setEditing] = useState<ActivityType | 'new' | null>(null);
  const remove = useMutation(
    trpc.activityType.delete.mutationOptions({
      onSuccess: async () => {
        toast('success', t.deleted);
        await queryClient.invalidateQueries(trpc.activityType.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const c = t.columns;
  const rows = types.data ?? [];
  return (
    <div className="min-w-0">
      <ActivitiesHeader active="types">
        {canWrite ? (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            {t.new}
          </Button>
        ) : null}
      </ActivitiesHeader>
      <main className="px-7 pt-5 pb-10">
        {types.isPending ? (
          <CardSkeleton lines={4} />
        ) : loadFailed(types) ? (
          <ErrorState onRetry={() => void types.refetch()} />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>{c.name}</TableHead>
                    <TableHead>{c.confirmLabel}</TableHead>
                    <TableHead>{c.product}</TableHead>
                    <TableHead>{c.entries}</TableHead>
                    <TableHead>{c.status}</TableHead>
                    <TableHead className="w-24" />
                  </tr>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} onClick={canWrite ? () => setEditing(row) : undefined}>
                      <TableCell className="font-semibold">{row.name}</TableCell>
                      <TableCell>
                        {row.confirmLabel ?? <span className="text-muted">{t.fromApp}</span>}
                      </TableCell>
                      <TableCell>{row.asksProduct ? t.asksProduct : t.noProduct}</TableCell>
                      <TableCell className="tabular-nums">{row.entries}</TableCell>
                      <TableCell>
                        <Badge tone={row.active ? 'success' : 'neutral'} dot>
                          {row.active ? t.active : t.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {canWrite ? (
                          <RowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t.edit}
                              title={t.edit}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditing(row);
                              }}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            {!row.system && row.entries === 0 && !row.inButtons ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={t.delete}
                                title={t.delete}
                                disabled={remove.isPending}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  remove.mutate({ id: row.id });
                                }}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                          </RowActions>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="border-t border-border-subtle px-5 py-3 text-[13px] text-muted">
              {t.count(rows.length)}
            </p>
          </Card>
        )}
      </main>
      {editing ? (
        <TypeDialog
          type={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/** A new type or a change of one, in a dialog. A podnet has no button, so nothing about one. */
function TypeDialog({ type, onClose }: { type?: ActivityType | undefined; onClose: () => void }) {
  const d = t.dialog;
  const toast = useToast();
  const queryClient = useQueryClient();
  const hasButton = !type || type.confirmLabel !== null;
  const [name, setName] = useState(type?.name ?? '');
  const [confirmLabel, setConfirmLabel] = useState(type?.confirmLabel ?? '');
  const [asksProduct, setAsksProduct] = useState(type?.asksProduct ?? false);
  const [active, setActive] = useState(type?.active ?? true);
  const done = {
    onSuccess: async () => {
      toast('success', t.saved);
      await queryClient.invalidateQueries(trpc.activityType.pathFilter());
      onClose();
    },
    onError: (error: Parameters<typeof errorMessage>[0]) =>
      toast('error', errorMessage(error, t.errors)),
  };
  const create = useMutation(trpc.activityType.create.mutationOptions(done));
  const update = useMutation(trpc.activityType.update.mutationOptions(done));
  const pending = create.isPending || update.isPending;
  const valid = name.trim() !== '' && (!hasButton || confirmLabel.trim() !== '');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            if (type) {
              update.mutate({
                id: type.id,
                name: name.trim(),
                confirmLabel: hasButton ? confirmLabel.trim() : null,
                asksProduct,
                active,
              });
            } else {
              create.mutate({
                name: name.trim(),
                confirmLabel: confirmLabel.trim(),
                asksProduct,
                active,
              });
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="type-name">{d.name}</Label>
            <Input
              id="type-name"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {hasButton ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="type-confirm">{d.confirmLabel}</Label>
                <Input
                  id="type-confirm"
                  maxLength={80}
                  value={confirmLabel}
                  onChange={(event) => setConfirmLabel(event.target.value)}
                />
                <p className="text-xs text-muted">{d.confirmHint}</p>
              </div>
              <div className="flex items-center gap-3 text-sm font-medium">
                <Switch
                  checked={asksProduct}
                  onChange={() => setAsksProduct(!asksProduct)}
                  label={d.asksProduct}
                />
                <span>
                  {d.asksProduct}
                  <span className="block text-xs font-normal text-muted">{d.asksProductHint}</span>
                </span>
              </div>
            </>
          ) : null}
          <div className="flex items-center gap-3 text-sm font-medium">
            <Switch checked={active} onChange={() => setActive(!active)} label={d.active} />
            <span>
              {d.active}
              {hasButton ? (
                <span className="block text-xs font-normal text-muted">{d.activeHint}</span>
              ) : null}
            </span>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {sk.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
