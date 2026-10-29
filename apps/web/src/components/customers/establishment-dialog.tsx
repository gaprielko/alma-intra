import { sk } from '@intra/shared/i18n';
import { personName, REGIONS, type Region } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { CustomerAvatar } from '@/components/customers/customer-bits';
import { useDebounced } from '@/components/customers/organization-list';
import { PhoneInput } from '@/components/phone-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { SegmentedChoice } from '@/components/ui/segmented';
import { Select, SelectItem } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const d = sk.establishments.dialog;

type PrimaryMode = 'organization' | 'existing' | 'new' | 'none';

/** What the dialog edits: a prevádzka's own fields (docs/establishments.md 6). */
interface Fields {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  region: Region | '';
  email: string;
  phone: string;
  almaOrganizationId: string;
  note: string;
}

export type EditedEstablishment = Pick<
  RouterOutputs['customer']['get'],
  'id' | 'name' | 'street' | 'postalCode' | 'city' | 'region' | 'email' | 'phone' | 'note'
> & { almaOrganizationId: string | null };

const fieldsOf = (e: EditedEstablishment | undefined): Fields => ({
  name: e?.name ?? '',
  street: e?.street ?? '',
  postalCode: e?.postalCode ?? '',
  city: e?.city ?? '',
  region: e?.region ?? '',
  email: e?.email ?? '',
  phone: e?.phone ?? '',
  almaOrganizationId: e?.almaOrganizationId ?? '',
  note: e?.note ?? '',
});

/**
 * „Nová prevádzka“ under an organization, with its primary contact (a person of the organization,
 * anyone from Kontakty, a new person, or nobody yet); with `establishment`, „Upraviť prevádzku“.
 */
export function EstablishmentDialog({
  parentId,
  parentName,
  establishment,
  onClose,
}: {
  parentId: string;
  parentName: string;
  establishment?: EditedEstablishment | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<Fields>(() => fieldsOf(establishment));
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));
  const [mode, setMode] = useState<PrimaryMode>('organization');
  const [picked, setPicked] = useState<string | null>(null);
  const [position, setPosition] = useState('');
  const [person, setPerson] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);

  const ours = useQuery({
    ...trpc.customer.persons.queryOptions({ id: parentId }),
    enabled: !establishment && mode === 'organization',
  });
  const anyone = useQuery({
    ...trpc.person.list.queryOptions({ search: term || undefined, pageSize: 8 }),
    enabled: !establishment && mode === 'existing' && term.length >= 2,
  });
  const candidates =
    mode === 'organization'
      ? (ours.data ?? [])
          .filter((p) =>
            term
              ? `${personName(p)} ${p.email ?? ''}`
                  .toLocaleLowerCase('sk')
                  .includes(term.toLocaleLowerCase('sk'))
              : true,
          )
          .map((p) => ({
            id: p.id,
            name: personName(p),
            sub: [
              p.position,
              p.atOrganization ? d.atOrganization : null,
              ...p.establishments.map((e) => e.name),
            ]
              .filter(Boolean)
              .join(' · '),
          }))
      : (anyone.data?.items ?? []).map((p) => ({
          id: p.id,
          name: personName(p),
          sub: [p.email, ...p.organizations.map((o) => o.name)].filter(Boolean).join(' · '),
        }));

  const done = async (message: string, id?: string) => {
    toast('success', message);
    await queryClient.invalidateQueries(trpc.customer.pathFilter());
    await queryClient.invalidateQueries(trpc.person.pathFilter());
    onClose();
    return id;
  };
  const onError = (error: unknown) => toast('error', errorMessage(error, sk.customers.errors));
  const create = useMutation(
    trpc.customer.establishmentCreate.mutationOptions({
      onSuccess: (created) => done(d.created, created.id),
      onError,
    }),
  );
  const update = useMutation(
    trpc.customer.establishmentUpdate.mutationOptions({ onSuccess: () => done(d.saved), onError }),
  );
  const pending = create.isPending || update.isPending;

  const input = { ...fields, region: fields.region || null };
  const primary =
    mode === 'new' && person.firstName.trim() && person.lastName.trim()
      ? { kind: 'new' as const, contact: { ...person, position } }
      : (mode === 'organization' || mode === 'existing') && picked
        ? { kind: 'existing' as const, contactId: picked, position }
        : undefined;
  const submit = () => {
    if (establishment) update.mutate({ id: establishment.id, establishment: input });
    else create.mutate({ parentId, establishment: input, ...(primary ? { primary } : {}) });
  };

  const text = (key: keyof Fields, label: string, className?: string) => (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={`est-${key}`}>{label}</Label>
      <Input
        id={`est-${key}`}
        value={fields[key]}
        onChange={(event) => set(key, event.target.value as never)}
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{establishment ? d.editTitle : d.newTitle}</DialogTitle>
          <DialogDescription>{d.under(parentName)}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {text('name', d.name, 'sm:col-span-6')}
          {text('street', d.street, 'sm:col-span-3')}
          {text('postalCode', d.postalCode, 'sm:col-span-1')}
          {text('city', d.city, 'sm:col-span-2')}
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="est-region">{d.region}</Label>
            <Select
              id="est-region"
              value={fields.region}
              onChange={(value) => set('region', value as Region | '')}
              placeholder={sk.common.none}
            >
              {REGIONS.map((region) => (
                <SelectItem key={region} value={region}>
                  {sk.customers.region[region]}
                </SelectItem>
              ))}
            </Select>
          </div>
          {text('email', d.email, 'sm:col-span-3')}
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="est-phone">{d.phone}</Label>
            <PhoneInput
              id="est-phone"
              value={fields.phone}
              onChange={(value) => set('phone', value)}
            />
          </div>
          {text('almaOrganizationId', d.almaId, 'sm:col-span-3')}
          <p className="self-center text-[13px] text-muted sm:col-span-6">{d.shared(parentName)}</p>

          {establishment ? null : (
            <div className="space-y-3 sm:col-span-6">
              <p className="text-sm font-semibold">{d.primary}</p>
              <SegmentedChoice
                label={d.primary}
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setPicked(null);
                  setSearch('');
                }}
                options={(['organization', 'existing', 'new', 'none'] as const).map((key) => ({
                  key,
                  label: d.primaryModes[key],
                }))}
              />
              {mode === 'organization' || mode === 'existing' ? (
                <>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                      aria-hidden
                    />
                    <Input
                      aria-label={mode === 'organization' ? d.searchOrganization : d.searchAll}
                      placeholder={mode === 'organization' ? d.searchOrganization : d.searchAll}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <ul className="max-h-60 space-y-2 overflow-y-auto">
                    {candidates.length === 0 && (mode === 'organization' || term.length >= 2) ? (
                      <li className="px-1 text-sm text-muted">{d.nobody}</li>
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
                            name="primary"
                            aria-label={c.name}
                            checked={picked === c.id}
                            onChange={() => setPicked(c.id)}
                            className="size-4 accent-[var(--color-primary)]"
                          />
                          <CustomerAvatar name={c.name} kind="individual" size={32} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{c.name}</span>
                            {c.sub ? (
                              <span className="block truncate text-xs text-muted">{c.sub}</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {picked ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="est-position">{d.position}</Label>
                      <Input
                        id="est-position"
                        value={position}
                        onChange={(event) => setPosition(event.target.value)}
                      />
                      <p className="text-xs text-muted">{d.positionHint}</p>
                    </div>
                  ) : null}
                </>
              ) : null}
              {mode === 'new' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['firstName', 'lastName', 'email'] as const).map((key) => (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={`est-person-${key}`}>
                        {d[key === 'email' ? 'email' : key]}
                      </Label>
                      <Input
                        id={`est-person-${key}`}
                        value={person[key]}
                        onChange={(event) => setPerson({ ...person, [key]: event.target.value })}
                      />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label htmlFor="est-person-phone">{d.phone}</Label>
                    <PhoneInput
                      id="est-person-phone"
                      value={person.phone}
                      onChange={(value) => setPerson({ ...person, phone: value })}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="est-person-position">{d.position}</Label>
                    <Input
                      id="est-person-position"
                      value={position}
                      onChange={(event) => setPosition(event.target.value)}
                    />
                  </div>
                </div>
              ) : null}
              {mode === 'none' ? null : primary ? null : (
                <Badge tone="neutral">{sk.establishments.noPrimary}</Badge>
              )}
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-6">
            <Label htmlFor="est-note">{d.note}</Label>
            <Textarea
              id="est-note"
              rows={2}
              maxLength={4000}
              value={fields.note}
              onChange={(event) => set('note', event.target.value)}
            />
          </div>
          <DialogFooter className="sm:col-span-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={pending || fields.name.trim().length < 2}>
              {pending ? sk.common.saving : establishment ? sk.common.save : d.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
