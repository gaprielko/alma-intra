import { sk } from '@intra/shared/i18n';
import { personName } from '@intra/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { Building2, Search, Store, UserRound } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useDebounced } from '@/components/customers/organization-list';
import { trpc } from '@/lib/trpc';

const t = sk.inbound.contactSearch;

/** What was picked: an organization (or private person), a prevádzka, or a contact person. */
export type ContactPick =
  | { kind: 'organization'; id: string; name: string }
  | { kind: 'establishment'; id: string; name: string; parentName: string }
  | {
      kind: 'person';
      id: string;
      name: string;
      /** The person's first organization; a person without one cannot be filed under. */
      organization: { id: string; name: string } | null;
    };

/**
 * One field that finds organizations, their prevádzky and contact persons at once, for filing an
 * e-mail or filtering by whom it is from. Results show from two typed letters.
 */
export function ContactSearch({
  onPick,
  footer,
}: {
  onPick: (pick: ContactPick) => void;
  footer?: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  const term = useDebounced(typed.trim(), 250);
  const enabled = term.length >= 2;
  const customers = useQuery({
    ...trpc.customer.list.queryOptions({ search: term, pageSize: 6 }),
    enabled,
  });
  const persons = useQuery({
    ...trpc.person.list.queryOptions({ search: term, pageSize: 6 }),
    enabled,
  });
  const organizations = customers.data?.items ?? [];
  const establishments = organizations.filter(
    (o): o is typeof o & { foundEstablishmentId: string; foundEstablishment: string } =>
      o.foundEstablishmentId !== null && o.foundEstablishment !== null,
  );
  const people = persons.data?.items ?? [];
  const nothing =
    customers.isSuccess &&
    persons.isSuccess &&
    organizations.length === 0 &&
    establishments.length === 0 &&
    people.length === 0;

  const option = (key: string, icon: ReactNode, label: string, note: string, pick: () => void) => (
    <li key={key}>
      <button
        type="button"
        onClick={pick}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
      >
        {icon}
        <span className="min-w-0">
          <span className="block truncate font-semibold">{label}</span>
          {note ? <span className="block truncate text-xs text-muted">{note}</span> : null}
        </span>
      </button>
    </li>
  );
  const group = (title: string, items: ReactNode[]) =>
    items.length > 0 ? (
      <>
        <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">{title}</p>
        <ul>{items}</ul>
      </>
    ) : null;

  return (
    <div className="w-[22rem] max-w-[calc(100vw-2rem)]">
      <label className="flex h-10 items-center gap-2 rounded-[10px] border-2 border-primary px-3">
        <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
        <span className="sr-only">{t.label}</span>
        <input
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={t.label}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-tertiary"
        />
      </label>
      {enabled ? (
        <div className="mt-2 max-h-80 overflow-y-auto">
          {group(
            t.organizations,
            organizations.map((o) =>
              option(
                o.id,
                o.kind === 'organization' ? (
                  <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
                ) : (
                  <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                ),
                o.name,
                o.city ?? '',
                () => onPick({ kind: 'organization', id: o.id, name: o.name }),
              ),
            ),
          )}
          {group(
            t.establishments,
            establishments.map((o) =>
              option(
                o.foundEstablishmentId,
                <Store className="size-4 shrink-0 text-warning" aria-hidden />,
                o.foundEstablishment,
                t.establishmentOf(o.name),
                () =>
                  onPick({
                    kind: 'establishment',
                    id: o.foundEstablishmentId,
                    name: o.foundEstablishment,
                    parentName: o.name,
                  }),
              ),
            ),
          )}
          {group(
            t.persons,
            people.map((p) => {
              const home = p.organizations[0] ?? null;
              return option(
                p.id,
                <UserRound className="size-4 shrink-0 text-muted" aria-hidden />,
                personName(p),
                [p.email, home?.name].filter(Boolean).join(' · '),
                () =>
                  onPick({
                    kind: 'person',
                    id: p.id,
                    name: personName(p),
                    organization: home ? { id: home.id, name: home.name } : null,
                  }),
              );
            }),
          )}
          {nothing ? <p className="px-3 py-2.5 text-sm text-muted">{t.nothing}</p> : null}
        </div>
      ) : null}
      {footer ? <div className="mt-2 border-t border-border-subtle pt-2">{footer}</div> : null}
    </div>
  );
}
