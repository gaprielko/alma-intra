import { sk } from '@intra/shared/i18n';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { CustomerAvatar } from '@/components/customers/customer-bits';
import { useDebounced } from '@/components/customers/organization-list';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const o = sk.organizations;
const p = o.persons;

/**
 * „Existujúca osoba z Kontaktov“: a person who already works elsewhere (or nowhere) put at this
 * organization too, with a position here (D-3).
 */
export function ExistingPersonDialog({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 300);
  const [picked, setPicked] = useState<string | null>(null);
  const [position, setPosition] = useState('');
  const [isPrimary, setPrimary] = useState(false);
  const found = useQuery({
    ...trpc.person.list.queryOptions({ search: search || undefined, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const candidates = (found.data?.items ?? []).filter(
    (person) => !person.organizations.some((org) => org.id === customerId),
  );
  const link = useMutation(
    trpc.person.link.mutationOptions({
      onSuccess: async () => {
        toast('success', p.linked);
        await Promise.all([
          queryClient.invalidateQueries(trpc.customer.pathFilter()),
          queryClient.invalidateQueries(trpc.person.pathFilter()),
        ]);
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, p.errors)),
    }),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{o.existingDialog.title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (picked) {
              link.mutate({
                id: picked,
                customerId,
                position: position.trim() || undefined,
                isPrimary,
              });
            }
          }}
        >
          <label className="flex h-10 items-center gap-2 rounded-[10px] border border-border bg-white px-3 focus-within:border-primary">
            <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
            <span className="sr-only">{o.existingDialog.search}</span>
            <input
              type="search"
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={o.existingDialog.searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <ul
            role="listbox"
            aria-label={o.existingDialog.search}
            className="max-h-64 overflow-y-auto"
          >
            {candidates.length === 0 ? (
              <li className="px-1 py-3 text-sm text-muted">{o.existingDialog.empty}</li>
            ) : (
              candidates.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={picked === person.id}
                    onClick={() => setPicked(person.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover',
                      picked === person.id && 'bg-primary-soft',
                    )}
                  >
                    <CustomerAvatar name={person.name} kind="individual" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{person.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {person.organizations.length === 0
                          ? p.noOrganization
                          : person.organizations
                              .map((org) => p.positionAt(org.position, org.name))
                              .join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="existing-position">{p.linkDialog.position}</Label>
            <Input
              id="existing-position"
              maxLength={120}
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isPrimary} onChange={() => setPrimary(!isPrimary)} />
            {p.linkDialog.primary}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={!picked || link.isPending}>
              {p.linkDialog.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
