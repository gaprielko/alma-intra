import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Info, Search, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { CustomerAvatar } from '@/components/customers/customer-bits';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const o = sk.organizations;
const d = o.userDialog;
const f = sk.contacts.dialog;

type Candidate = RouterOutputs['person']['userCandidates'][number];

/** The row of a user: who they are and what adding them would do. */
function UserRow({
  user,
  picked,
  onPick,
}: {
  user: Candidate;
  picked: boolean;
  onPick?: (() => void) | undefined;
}) {
  const details = [user.email, user.status === 'invited' ? d.invited : user.position].filter(
    Boolean,
  );
  return (
    <button
      type="button"
      role="option"
      aria-selected={picked}
      disabled={user.alreadyHere}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover',
        picked && 'bg-primary-soft hover:bg-primary-soft',
        user.alreadyHere && 'cursor-default opacity-55 hover:bg-transparent',
      )}
    >
      <CustomerAvatar name={user.fullName} kind="individual" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{user.fullName}</span>
        <span className="block truncate text-xs text-muted">{details.join(' · ')}</span>
      </span>
      {picked ? (
        <Check className="size-[18px] shrink-0 text-primary" aria-hidden />
      ) : user.alreadyHere || user.contactId ? (
        <span className="shrink-0 text-xs font-medium text-muted">
          {user.alreadyHere ? d.here : d.elsewhere}
        </span>
      ) : null}
    </button>
  );
}

/**
 * „Používateľ aplikácie“: a colleague, or the user themself, as a contact of the organization. Their
 * details are not entered, they follow the user (D-47). A contact with their e-mail is connected
 * after the dialog has shown what would change.
 */
export function UserContactDialog({
  customerId,
  customerName,
  onClose,
}: {
  customerId: string;
  customerName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [position, setPosition] = useState('');
  const [isPrimary, setPrimary] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const users = useQuery(trpc.person.userCandidates.queryOptions({ customerId }));
  const term = typed.trim().toLocaleLowerCase('sk');
  const found = (users.data ?? []).filter(
    (user) =>
      !term ||
      user.fullName.toLocaleLowerCase('sk').includes(term) ||
      user.email.toLowerCase().includes(term),
  );
  const picked = users.data?.find((user) => user.id === pickedId) ?? null;
  const add = useMutation(
    trpc.person.addUser.mutationOptions({
      onSuccess: async () => {
        toast('success', d.added);
        await Promise.all([
          queryClient.invalidateQueries(trpc.customer.pathFilter()),
          queryClient.invalidateQueries(trpc.person.pathFilter()),
        ]);
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, o.persons.errors)),
    }),
  );
  const pick = (user: Candidate) => {
    setPickedId(user.id);
    setPosition(user.position ?? '');
  };
  const submit = () => {
    if (!picked) return;
    if (picked.clash && !confirming) {
      setConfirming(true);
      return;
    }
    add.mutate({
      userId: picked.id,
      customerId,
      position: position.trim() || undefined,
      isPrimary,
      connect: confirming,
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.lead}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {confirming && picked?.clash ? (
            <>
              <UserRow user={picked} picked />
              <div
                role="status"
                className="flex gap-2.5 rounded-xl bg-warning-soft px-3.5 py-3 text-[13px] leading-5 text-warning"
              >
                <TriangleAlert className="mt-0.5 size-[18px] shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{d.clashTitle}</p>
                  <p className="mt-0.5">
                    {picked.clash.changes.length > 0
                      ? d.clashText(picked.clash.name, picked.clash.organizations)
                      : d.clashSame(picked.clash.name, picked.clash.organizations)}
                  </p>
                  {picked.clash.changes.length > 0 ? (
                    <table className="mt-2 w-full">
                      <thead>
                        <tr className="text-left text-xs font-medium">
                          <th className="pr-3 pb-1 font-medium">
                            <span className="sr-only">{d.field}</span>
                          </th>
                          <th className="pr-3 pb-1 font-medium">{d.now}</th>
                          <th className="pb-1 font-medium">{d.after}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {picked.clash.changes.map((change) => (
                          <tr key={change.field} className="border-t border-warning/15">
                            <td className="py-1 pr-3">{f[change.field]}</td>
                            <td className="py-1 pr-3">{change.from || sk.common.none}</td>
                            <td className="py-1 font-semibold">{change.to || sk.common.none}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <>
              <label className="flex h-10 items-center gap-2 rounded-[10px] border border-border bg-white px-3">
                <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
                <span className="sr-only">{d.search}</span>
                <input
                  type="search"
                  autoFocus
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={d.searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              <div role="listbox" aria-label={d.search} className="max-h-64 overflow-y-auto">
                {users.isPending ? (
                  <p className="px-1 py-3 text-sm text-muted">{sk.common.loading}</p>
                ) : found.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-muted">{d.empty}</p>
                ) : (
                  found.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      picked={user.id === pickedId}
                      onPick={() => pick(user)}
                    />
                  ))
                )}
              </div>
            </>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="space-y-2">
              <Label htmlFor="user-contact-position">{d.position(customerName)}</Label>
              <Input
                id="user-contact-position"
                maxLength={120}
                value={position}
                onChange={(event) => setPosition(event.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-[13px] whitespace-nowrap">
              <Checkbox checked={isPrimary} onChange={() => setPrimary(!isPrimary)} />
              {sk.contacts.primary}
            </label>
          </div>
          {confirming ? null : (
            <p
              role="note"
              className="flex gap-2.5 rounded-xl bg-info-soft px-3.5 py-3 text-[13px] leading-5 text-info"
            >
              <Info className="mt-0.5 size-[18px] shrink-0" aria-hidden />
              <span>{d.note}</span>
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={confirming ? () => setConfirming(false) : onClose}
            >
              {confirming ? sk.common.back : sk.common.cancel}
            </Button>
            <Button type="submit" disabled={!picked || add.isPending}>
              {confirming ? d.connect : d.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
