import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useDebounced } from '@/components/customers/organization-list';
import { PhoneInput } from '@/components/phone-input';
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
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { type RouterOutputs, trpc } from '@/lib/trpc';

const p = sk.organizations.persons;
const d = p.dialog;
const f = sk.contacts.dialog;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Person = RouterOutputs['person']['get'];
type LinkRow = { customerId: string; position: string; isPrimary: boolean };

/**
 * „Nová osoba“ and „Upraviť osobu“ (the PersonDialog board): the person's own data and, for a new
 * one, any number of organizations with a position each (D-2, D-3). An e-mail already in Kontakty
 * offers that person instead of a second one (D-7).
 */
export function PersonDialog({
  person,
  initialEmail,
  onCreated,
  onClose,
}: {
  person?: Person;
  /** A new person's address, e.g. the sender of an e-mail being filed. */
  initialEmail?: string | undefined;
  /** Instead of opening the new person: their id and first organization, to go on with. */
  onCreated?: ((created: { id: string; customerId: string | null }) => void) | undefined;
  onClose: () => void;
}) {
  const ids = useId();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    titleBefore: person?.titleBefore ?? '',
    firstName: person?.firstName ?? '',
    lastName: person?.lastName ?? '',
    titleAfter: person?.titleAfter ?? '',
    gender: person?.gender ?? '',
    salutation: person?.salutation ?? '',
    email: person?.email ?? initialEmail ?? '',
    phone: person?.phone ?? '',
    note: person?.note ?? '',
  });
  const [receivesBulk, setReceivesBulk] = useState(!person?.unsubscribedAt);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const typedEmail = useDebounced(values.email.trim().toLowerCase(), 400);
  const existing = useQuery({
    ...trpc.person.byEmail.queryOptions({ email: typedEmail }),
    enabled: EMAIL_RE.test(typedEmail) && typedEmail !== (person?.email ?? '').toLowerCase(),
  });
  const clash = existing.data && existing.data.id !== person?.id ? existing.data : null;
  const organizations = useQuery({
    ...trpc.customer.list.queryOptions({ kind: ['organization'], pageSize: 100, sort: 'name' }),
    enabled: !person,
  });

  const done = async (message: string, id: string) => {
    toast('success', message);
    await Promise.all([
      queryClient.invalidateQueries(trpc.person.pathFilter()),
      queryClient.invalidateQueries(trpc.customer.pathFilter()),
    ]);
    onClose();
    if (person) return;
    if (onCreated) onCreated({ id, customerId: links[0]?.customerId ?? null });
    else await navigate({ to: '/contacts/$personId', params: { personId: id } });
  };
  const onError = (error: unknown) => toast('error', errorMessage(error, p.errors));
  const create = useMutation(
    trpc.person.create.mutationOptions({
      onSuccess: (created) => done(d.created, created.id),
      onError,
    }),
  );
  const update = useMutation(
    trpc.person.update.mutationOptions({
      onSuccess: () => done(d.saved, person!.id),
      onError,
    }),
  );
  const pending = create.isPending || update.isPending;

  const input = {
    titleBefore: values.titleBefore.trim() || undefined,
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    titleAfter: values.titleAfter.trim() || undefined,
    gender: (values.gender || undefined) as 'male' | 'female' | undefined,
    salutation: values.salutation.trim() || undefined,
    email: values.email.trim() || undefined,
    phone: values.phone.trim() || undefined,
    note: values.note.trim() || undefined,
  };
  const submit = () => {
    if (!input.firstName || !input.lastName || clash) return;
    if (person) update.mutate({ id: person.id, person: input, receivesBulk });
    else {
      create.mutate({
        person: input,
        receivesBulk,
        links: links
          .filter((l) => l.customerId)
          .map((l) => ({
            customerId: l.customerId,
            position: l.position.trim() || undefined,
            isPrimary: l.isPrimary,
          })),
      });
    }
  };

  const field = (key: keyof typeof values, label: string, className: string, type = 'text') => (
    <div className={className}>
      <Label htmlFor={`${ids}-${key}`}>{label}</Label>
      <Input
        id={`${ids}-${key}`}
        type={type}
        value={values[key]}
        onChange={(event) => set(key)(event.target.value)}
        className="mt-1.5"
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{person ? d.editTitle : d.newTitle}</DialogTitle>
          {person ? null : <DialogDescription>{d.lead}</DialogDescription>}
        </DialogHeader>
        <form
          noValidate
          className="grid grid-cols-6 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {field('titleBefore', f.titleBefore, 'col-span-6 sm:col-span-1')}
          {field('firstName', f.firstName, 'col-span-6 sm:col-span-2')}
          {field('lastName', f.lastName, 'col-span-6 sm:col-span-2')}
          {field('titleAfter', f.titleAfter, 'col-span-6 sm:col-span-1')}
          {field('email', f.email, 'col-span-6 sm:col-span-3', 'email')}
          <div className="col-span-6 sm:col-span-3">
            <Label htmlFor={`${ids}-phone`}>{f.phone}</Label>
            <div className="mt-1.5">
              <PhoneInput id={`${ids}-phone`} value={values.phone} onChange={set('phone')} />
            </div>
          </div>
          {clash ? (
            <div
              role="status"
              className="col-span-6 rounded-xl bg-warning-soft px-4 py-3 text-[13px] leading-5 text-warning"
            >
              <p className="font-semibold">{d.exists}</p>
              <p className="mt-0.5">
                {d.existsText(
                  [
                    clash.name,
                    ...clash.organizations.map((o) => p.positionAt(o.position, o.name)),
                  ].join(', '),
                )}
              </p>
              <Link
                to="/contacts/$personId"
                params={{ personId: clash.id }}
                onClick={onClose}
                className="mt-1 inline-block font-semibold underline"
              >
                {d.useExisting}
              </Link>
            </div>
          ) : null}
          <div className="col-span-6 sm:col-span-3">
            <Label htmlFor={`${ids}-gender`}>{f.gender}</Label>
            <Select
              id={`${ids}-gender`}
              value={values.gender}
              onChange={set('gender')}
              className="mt-1.5"
            >
              <SelectItem value="">{sk.common.none}</SelectItem>
              <SelectItem value="male">{f.male}</SelectItem>
              <SelectItem value="female">{f.female}</SelectItem>
            </Select>
          </div>
          {field('salutation', f.salutation, 'col-span-6 sm:col-span-3')}

          {person ? null : (
            <div className="col-span-6 space-y-2">
              <p className="text-sm font-semibold">
                {d.organizations}{' '}
                <span className="text-xs font-normal text-muted">{d.organizationsHint}</span>
              </p>
              {links.map((link, index) => {
                const name =
                  organizations.data?.items.find((o) => o.id === link.customerId)?.name ?? '';
                const change = (next: Partial<LinkRow>) =>
                  setLinks((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, ...next } : row)),
                  );
                return (
                  <div
                    key={index}
                    className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border border-border-subtle p-2"
                  >
                    <Select
                      aria-label={sk.organizations.persons.organization}
                      value={link.customerId}
                      onChange={(customerId) => change({ customerId })}
                    >
                      <SelectItem value="">{p.linkDialog.pick}</SelectItem>
                      {(organizations.data?.items ?? []).map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {`${o.name} · ${p.roles[o.role]}`}
                        </SelectItem>
                      ))}
                    </Select>
                    <Input
                      aria-label={p.linkDialog.position}
                      placeholder={p.linkDialog.position}
                      maxLength={120}
                      value={link.position}
                      onChange={(event) => change({ position: event.target.value })}
                    />
                    <label className="flex items-center gap-1.5 text-[13px] whitespace-nowrap">
                      <Checkbox
                        checked={link.isPrimary}
                        onChange={() => change({ isPrimary: !link.isPrimary })}
                      />
                      {sk.contacts.primary}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={d.removeOrganization(name)}
                      onClick={() => setLinks((rows) => rows.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLinks((rows) => [...rows, { customerId: '', position: '', isPrimary: false }])
                }
              >
                <Plus className="size-3.5" aria-hidden />
                {d.addOrganization}
              </Button>
            </div>
          )}

          <div className="col-span-6 flex items-center gap-3 rounded-xl border border-border-subtle px-4 py-3">
            <span className="flex-1">
              <span className="block text-sm font-semibold">{f.receivesBulk}</span>
              <span className="block text-[13px] text-muted">{f.receivesBulkHint}</span>
            </span>
            <Switch
              checked={receivesBulk}
              label={f.receivesBulk}
              onChange={() => setReceivesBulk(!receivesBulk)}
            />
          </div>
          <div className="col-span-6">
            <Label htmlFor={`${ids}-note`}>{f.note}</Label>
            <Textarea
              id={`${ids}-note`}
              rows={2}
              maxLength={2000}
              value={values.note}
              onChange={(event) => set('note')(event.target.value)}
              className="mt-1.5"
            />
          </div>
          <DialogFooter className="col-span-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={pending || !input.firstName || !input.lastName || clash !== null}
            >
              {d.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
