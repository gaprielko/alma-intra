import { sk } from '@intra/shared/i18n';
import type { CustomerFilter } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronDown, Trash2, Users } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { trpc } from '@/lib/trpc';

const t = sk.segments;

/**
 * „Segmenty“ over the contact list: a saved segment applies its filters; the filters set now are
 * saved as a new one (for me, or shared); my own ones can be deleted here.
 */
export function SegmentsMenu({
  filter,
  onApply,
}: {
  /** The filters set now; empty means there is nothing to save. */
  filter: CustomerFilter;
  onApply: (filter: CustomerFilter) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const segments = useQuery(trpc.segment.list.queryOptions());
  const remove = useMutation(
    trpc.segment.delete.mutationOptions({
      onSuccess: async () => {
        toast('success', t.deleted);
        await queryClient.invalidateQueries(trpc.segment.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  const hasFilter = Object.keys(filter).length > 0;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Bookmark className="size-3.5" aria-hidden />
            {t.title}
            <ChevronDown className="size-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {(segments.data ?? []).length === 0 ? (
            <DropdownMenuLabel className="font-normal text-muted">{t.empty}</DropdownMenuLabel>
          ) : (
            segments.data!.map((segment) => (
              <DropdownMenuItem key={segment.id} onSelect={() => onApply(segment.filters)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{segment.name}</span>
                  {segment.mine ? null : (
                    <span className="block truncate text-xs text-muted">
                      {t.sharedBy(segment.ownerName)}
                    </span>
                  )}
                </span>
                {segment.shared && segment.mine ? (
                  <Users className="size-3.5 text-muted" aria-label={t.sharedLabel} />
                ) : null}
                {segment.mine ? (
                  <button
                    type="button"
                    aria-label={t.delete(segment.name)}
                    className="rounded p-1 text-muted hover:bg-hover hover:text-danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      remove.mutate({ id: segment.id });
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasFilter} onSelect={() => setSaving(true)}>
            {hasFilter ? t.save : t.saveNeedsFilter}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {saving ? <SaveSegmentDialog filter={filter} onClose={() => setSaving(false)} /> : null}
    </>
  );
}

function SaveSegmentDialog({ filter, onClose }: { filter: CustomerFilter; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const create = useMutation(
    trpc.segment.create.mutationOptions({
      onSuccess: async () => {
        toast('success', t.saved);
        await queryClient.invalidateQueries(trpc.segment.pathFilter());
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  const d = t.dialog;
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.lead}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="segment-name">{d.name}</Label>
            <Input
              id="segment-name"
              className="mt-1.5"
              maxLength={80}
              placeholder={d.namePlaceholder}
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border-subtle p-4">
            <div>
              <p className="text-sm font-medium">{d.shared}</p>
              <p className="text-xs text-muted">{d.sharedHint}</p>
            </div>
            <Switch checked={shared} label={d.shared} onChange={() => setShared(!shared)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ name: name.trim(), filters: filter, shared })}
          >
            {d.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
