import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { CustomerAvatar } from '@/components/customers/customer-bits';
import { useDebounced } from '@/components/customers/organization-list';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const d = sk.establishments.attach;

/**
 * „Zaradiť pod organizáciu…“ (P-14): the organization becomes a prevádzka of the one picked here,
 * keeping its persons, timeline and files.
 */
export function AttachDialog({
  organizationId,
  organizationName,
  onClose,
}: {
  organizationId: string;
  organizationName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);
  const [picked, setPicked] = useState<string | null>(null);
  const found = useQuery({
    ...trpc.customer.list.queryOptions({ search: term, kind: ['organization'], pageSize: 8 }),
    enabled: term.length >= 2,
  });
  const attach = useMutation(
    trpc.customer.establishmentAttach.mutationOptions({
      onSuccess: async () => {
        toast('success', d.done);
        await queryClient.invalidateQueries(trpc.customer.pathFilter());
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, sk.customers.errors)),
    }),
  );
  const candidates = (found.data?.items ?? []).filter((c) => c.id !== organizationId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.description(organizationName)}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            aria-label={d.search}
            placeholder={d.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {term.length >= 2 && found.isSuccess && candidates.length === 0 ? (
            <li className="px-1 text-sm text-muted">{d.nothing}</li>
          ) : null}
          {candidates.map((c) => (
            <li key={c.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5',
                  picked === c.id && 'border-primary bg-primary-soft/40',
                )}
              >
                <input
                  type="radio"
                  name="parent"
                  aria-label={c.name}
                  checked={picked === c.id}
                  onChange={() => setPicked(c.id)}
                  className="size-4 accent-[var(--color-primary)]"
                />
                <CustomerAvatar name={c.name} kind={c.kind} size={32} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{c.name}</span>
                  {c.city ? <span className="block text-xs text-muted">{c.city}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">{d.keeps}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={!picked || attach.isPending}
            onClick={() => picked && attach.mutate({ id: organizationId, parentId: picked })}
          >
            {d.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
