import { sk } from '@intra/shared/i18n';
import { personName } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ContactDialog } from '@/components/customers/contact-dialog';
import { CustomerAvatar, MultiFilterMenu } from '@/components/customers/customer-bits';
import { EstablishmentChip } from '@/components/customers/establishments-card';
import { ExistingPersonDialog } from '@/components/customers/existing-person-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { type RouterOutputs, trpc } from '@/lib/trpc';

const tc = sk.contacts;
const p = sk.establishments.persons;
const PAGE = 20;
/** The filter value for the persons at the organization itself, without a prevádzka. */
const OWN = '_organization';

type Person = RouterOutputs['customer']['persons'][number];

/**
 * Kontaktné osoby as a table (docs/establishments.md 4.2): the persons of an organization and of
 * all its prevádzky, each with where they are; a full-text search and a Prevádzka filter that takes
 * several values; 20 a page.
 */
export function PersonsTable({
  organizationId,
  organizationName,
  hasEstablishments,
}: {
  organizationId: string;
  organizationName: string;
  hasEstablishments: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const persons = useQuery(trpc.customer.persons.queryOptions({ id: organizationId }));
  const [search, setSearch] = useState('');
  const [places, setPlaces] = useState<string[] | undefined>();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ person: Person; at: string } | 'new' | null>(null);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<{ person: Person; at: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries(trpc.customer.pathFilter());
  const primary = useMutation(
    trpc.customer.contactSetPrimary.mutationOptions({
      onSuccess: async () => {
        toast('success', tc.primaryDone);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error, sk.customers.errors)),
    }),
  );
  const remove = useMutation(
    trpc.customer.contactDelete.mutationOptions({
      onSuccess: async () => {
        toast('success', tc.deleteConfirm.done);
        setRemoving(null);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error, sk.customers.errors)),
    }),
  );

  const all = persons.data ?? [];
  const establishments = useMemo(() => {
    const seen = new Map<string, { name: string; count: number }>();
    for (const person of all)
      for (const e of person.establishments) {
        const entry = seen.get(e.id) ?? { name: e.name, count: 0 };
        entry.count += 1;
        seen.set(e.id, entry);
      }
    return [...seen.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'sk'));
  }, [all]);
  const term = search.trim().toLocaleLowerCase('sk');
  const shown = all.filter((person) => {
    if (places) {
      const here =
        (places.includes(OWN) && person.atOrganization) ||
        person.establishments.some((e) => places.includes(e.id));
      if (!here) return false;
    }
    if (!term) return true;
    return [personName(person), person.email, person.phone, person.position]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('sk')
      .includes(term);
  });
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages);
  const rows = shown.slice((current - 1) * PAGE, current * PAGE);
  // Where a person is edited and taken off: here, or at their (first) prevádzka.
  const placeOf = (person: Person) =>
    person.atOrganization ? organizationId : (person.establishments[0]?.id ?? organizationId);

  return (
    <Card>
      <CardHeader
        title={
          <>
            {tc.title}
            <span className="ml-1.5 font-normal text-muted">· {all.length}</span>
          </>
        }
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <Plus className="size-3.5" aria-hidden />
                {tc.add}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing('new')}>
                <span>
                  <span className="block font-medium">{sk.organizations.addNewPerson}</span>
                  <span className="block text-xs text-muted">
                    {sk.organizations.addNewPersonHint}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPicking(true)}>
                <span>
                  <span className="block font-medium">{sk.organizations.addExistingPerson}</span>
                  <span className="block text-xs text-muted">
                    {sk.organizations.addExistingPersonHint}
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {all.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-muted">{tc.empty}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
            <div className="relative min-w-60 flex-1 sm:max-w-sm">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                aria-label={p.search}
                placeholder={p.search}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="h-9 pl-9"
              />
            </div>
            {hasEstablishments ? (
              <MultiFilterMenu
                label={p.filter}
                values={places}
                onChange={(next) => {
                  setPlaces(next);
                  setPage(1);
                }}
                options={[
                  {
                    value: OWN,
                    label: p.onlyOrganization,
                    count: all.filter((x) => x.atOrganization).length,
                  },
                  ...establishments.map(([id, e]) => ({
                    value: id,
                    label: e.name,
                    count: e.count,
                  })),
                ]}
              />
            ) : null}
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>{p.columns.name}</TableHead>
                  {hasEstablishments ? <TableHead>{p.columns.place}</TableHead> : null}
                  <TableHead>{p.columns.contact}</TableHead>
                  <TableHead className="w-12" />
                </tr>
              </TableHeader>
              <TableBody>
                {rows.map((person) => {
                  const name = personName(person);
                  const at = placeOf(person);
                  return (
                    <TableRow key={person.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <CustomerAvatar
                            name={`${person.firstName} ${person.lastName}`}
                            kind="individual"
                            size={32}
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link
                                to="/contacts/$personId"
                                params={{ personId: person.id }}
                                className="font-semibold hover:underline"
                              >
                                {name}
                              </Link>
                              {person.isPrimary ? <Badge tone="info">{tc.primary}</Badge> : null}
                              {person.unsubscribedAt ? (
                                <Badge tone="warning">{tc.unsubscribed}</Badge>
                              ) : null}
                              {person.emailStatus !== 'ok' ? (
                                <Badge tone="danger">{tc.bounced}</Badge>
                              ) : null}
                            </div>
                            {person.position ? (
                              <span className="block text-xs text-muted">{person.position}</span>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      {hasEstablishments ? (
                        <TableCell className="max-w-56">
                          <div className="flex flex-wrap gap-1">
                            {person.establishments.map((e) => (
                              <EstablishmentChip
                                key={e.id}
                                name={e.isPrimary ? `${e.name} · ${p.primaryShort}` : e.name}
                              />
                            ))}
                            {person.atOrganization && person.establishments.length === 0 ? (
                              <span className="text-xs text-muted">{p.organization}</span>
                            ) : null}
                          </div>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        {person.email ? (
                          <a
                            href={`mailto:${person.email}`}
                            className="text-primary-text hover:underline"
                          >
                            {person.email}
                          </a>
                        ) : null}
                        {person.phone ? (
                          <span className="block text-xs whitespace-nowrap text-muted">
                            {person.phone}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" aria-label={tc.menu(name)}>
                              <MoreHorizontal className="size-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing({ person, at })}>
                              {tc.edit}
                            </DropdownMenuItem>
                            {person.atOrganization && !person.isPrimary ? (
                              <DropdownMenuItem
                                onSelect={() =>
                                  primary.mutate({ id: person.id, customerId: organizationId })
                                }
                              >
                                {tc.makePrimary}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              onSelect={() => setRemoving({ person, at })}
                            >
                              {tc.dialog.delete}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-5 py-3 text-[13px] text-muted">
            <span>{p.shown(shown.length, all.length)}</span>
            {pages > 1 ? (
              <span className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                >
                  ‹
                </Button>
                {current} / {pages}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={current >= pages}
                  onClick={() => setPage(current + 1)}
                >
                  ›
                </Button>
              </span>
            ) : null}
          </div>
        </>
      )}
      {picking ? (
        <ExistingPersonDialog customerId={organizationId} onClose={() => setPicking(false)} />
      ) : null}
      {editing ? (
        <ContactDialog
          customerId={editing === 'new' ? organizationId : editing.at}
          customerName={organizationName}
          contact={editing === 'new' ? undefined : editing.person}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => setRemoving(editing)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={tc.deleteConfirm.title(personName(removing.person))}
          description={tc.deleteConfirm.text}
          confirmLabel={tc.deleteConfirm.confirm}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ id: removing.person.id, customerId: removing.at })}
        />
      ) : null}
    </Card>
  );
}
