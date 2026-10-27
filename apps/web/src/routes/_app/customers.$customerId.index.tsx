import { sk } from '@intra/shared/i18n';
import { CUSTOMER_STATUSES, type CustomerStatus, personName } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ContactDialog, type Contact } from '@/components/customers/contact-dialog';
import { CustomerAvatar, CustomerStatusBadge, TagChip } from '@/components/customers/customer-bits';
import { ErrorState } from '@/components/empty-state';
import { CustomerFilesCard } from '@/components/files/customer-files-card';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
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
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { type RouterOutputs, trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/customers/$customerId/')({
  component: CustomerDetailPage,
});

const t = sk.customers.detail;
const f = t.fields;
type Customer = RouterOutputs['customer']['get'];

function CustomerDetailPage() {
  const { customerId } = Route.useParams();
  const customer = useQuery(trpc.customer.get.queryOptions({ id: customerId }));
  const [deleting, setDeleting] = useState(false);

  if (customer.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader title={sk.common.loading} back={{ to: '/customers', label: t.back }} />
        <div className="grid gap-5 p-7 xl:grid-cols-2">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      </div>
    );
  }
  if (loadFailed(customer)) {
    return (
      <div className="min-w-0">
        <PageHeader title={sk.customers.title} back={{ to: '/customers', label: t.back }} />
        <div className="p-10">
          <ErrorState
            text={errorMessage(customer.error, sk.customers.errors)}
            onRetry={() => void customer.refetch()}
          />
        </div>
      </div>
    );
  }
  const c = customer.data;
  const meta = [
    c.kind === 'individual'
      ? sk.customers.kind.individual
      : (c.typeName ?? sk.customers.filters.noType),
    c.city,
    c.ico ? t.ico(c.ico.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1 $2 $3')) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-w-0">
      <PageHeader
        title={c.name}
        subtitle={meta}
        back={{ to: '/customers', label: t.back }}
        badge={<CustomerStatusBadge status={c.status} />}
      >
        <Button variant="secondary" asChild>
          <Link to="/customers/$customerId/edit" params={{ customerId }}>
            <Pencil className="size-4" aria-hidden />
            {t.edit}
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" aria-label={t.more}>
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
              {t.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      <main className="grid max-w-[1400px] items-start gap-5 px-7 pt-5 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-5">
          {c.kind === 'organization' ? <ContactsCard customer={c} /> : null}
          <HistoryCard customerId={customerId} />
        </div>
        <div className="min-w-0 space-y-5">
          {c.kind === 'organization' ? (
            <OrganizationCard customer={c} />
          ) : (
            <PersonCard customer={c} />
          )}
          <ClassificationCard customer={c} />
          <CustomerFilesCard customerId={customerId} />
        </div>
      </main>

      {deleting ? <DeleteCustomer customer={c} onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border-subtle px-5 pt-2 pb-4">{children}</dl>;
}

/** One line of a card: the label on the left, the value on the right. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? sk.common.none}</dd>
    </div>
  );
}

const address = (c: Customer) =>
  [c.street, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;

const webHref = (web: string) => (/^https?:\/\//.test(web) ? web : `https://${web}`);

function OrganizationCard({ customer: c }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader title={t.basics} />
      <Rows>
        <Row label={f.kind}>{sk.customers.kind[c.kind]}</Row>
        <Row label={f.type}>{c.typeName ?? sk.customers.filters.noType}</Row>
        <Row label={f.ico}>{c.ico}</Row>
        <Row label={f.dic}>{c.dic}</Row>
        <Row label={f.icDph}>{c.icDph}</Row>
        <Row label={f.region}>{c.region ? sk.customers.region[c.region] : null}</Row>
        <Row label={f.address}>{address(c)}</Row>
        <Row label={f.web}>
          {c.web ? (
            <a
              href={webHref(c.web)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary-text hover:underline"
            >
              {c.web}
            </a>
          ) : null}
        </Row>
        <Row label={f.phone}>
          {c.phone ? <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> : null}
        </Row>
        <Row label={f.email}>
          {c.email ? (
            <a href={`mailto:${c.email}`} className="text-primary-text hover:underline">
              {c.email}
            </a>
          ) : null}
        </Row>
      </Rows>
    </Card>
  );
}

function PersonCard({ customer: c }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader title={t.personal} />
      <Rows>
        <Row label={f.name}>{c.name}</Row>
        <Row label={f.kind}>{sk.customers.kind[c.kind]}</Row>
        <Row label={f.salutation}>{c.salutation}</Row>
        <Row label={f.email}>
          {c.email ? (
            <a href={`mailto:${c.email}`} className="text-primary-text hover:underline">
              {c.email}
            </a>
          ) : null}
        </Row>
        <Row label={f.phone}>{c.phone}</Row>
        <Row label={f.bulk}>
          {c.unsubscribedAt ? (
            <Badge tone="warning">{t.unsubscribed}</Badge>
          ) : (
            <Badge tone="success">{t.receives}</Badge>
          )}
        </Row>
        <Row label={f.address}>{address(c)}</Row>
        <Row label={f.region}>{c.region ? sk.customers.region[c.region] : null}</Row>
      </Rows>
    </Card>
  );
}

function ClassificationCard({ customer: c }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader title={t.classification} />
      <Rows>
        {c.kind === 'individual' ? (
          <Row label={f.type}>{c.typeName ?? sk.customers.filters.noType}</Row>
        ) : null}
        <Row label={f.owner}>{c.owner?.name}</Row>
        <Row label={f.source}>{c.sourceName}</Row>
        <Row label={f.tags}>
          <TagsQuickAdd customer={c} />
        </Row>
        {c.kind === 'organization' ? <Row label={f.almaId}>{c.almaOrganizationId}</Row> : null}
        <Row label={f.created}>
          {c.createdBy
            ? t.createdBy(formatDate(c.createdAt), c.createdBy)
            : formatDate(c.createdAt)}
        </Row>
        <Row label={f.note}>
          {c.note ? <span className="whitespace-pre-line">{c.note}</span> : null}
        </Row>
      </Rows>
    </Card>
  );
}

/** The tags, and „+ Pridať štítok“ right here, without opening the form. */
function TagsQuickAdd({ customer: c }: { customer: Customer }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const add = useMutation(
    trpc.customer.bulkAddTag.mutationOptions({
      onSuccess: async () => {
        setAdding(false);
        setName('');
        await queryClient.invalidateQueries(trpc.customer.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {c.tags.map((tag) => (
        <TagChip key={tag.id}>{tag.name}</TagChip>
      ))}
      {adding ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) add.mutate({ ids: [c.id], tag: name.trim() });
          }}
        >
          <input
            autoFocus
            aria-label={sk.customers.form.classification.tags}
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setAdding(false)}
            onBlur={() => !name.trim() && setAdding(false)}
            className="h-7 w-36 rounded-md border border-border px-2 text-xs outline-none focus:border-primary"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-xs font-semibold text-primary-text hover:underline"
        >
          + {sk.customers.bulk.addTag}
        </button>
      )}
    </div>
  );
}

function ContactsCard({ customer: c }: { customer: Customer }) {
  const tc = sk.contacts;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
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
        setEditing(null);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error, sk.customers.errors)),
    }),
  );
  return (
    <Card>
      <CardHeader
        title={
          <>
            {tc.title}
            <span className="ml-1.5 font-normal text-muted">· {c.contacts.length}</span>
          </>
        }
        action={
          <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-3.5" aria-hidden />
            {tc.add}
          </Button>
        }
      />
      {c.contacts.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-muted">{tc.empty}</p>
      ) : (
        <ul className="px-5 pt-2 pb-3">
          {c.contacts.map((contact) => {
            const name = personName(contact);
            return (
              <li
                key={contact.id}
                className="flex items-start gap-3 border-t border-border-subtle py-3.5 first:border-t-0"
              >
                <CustomerAvatar
                  name={`${contact.firstName} ${contact.lastName}`}
                  kind="individual"
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(contact)}
                      className="text-left font-semibold hover:underline"
                    >
                      {name}
                    </button>
                    {contact.isPrimary ? <Badge tone="info">{tc.primary}</Badge> : null}
                    {contact.unsubscribedAt ? (
                      <Badge tone="warning">{tc.unsubscribed}</Badge>
                    ) : null}
                    {contact.emailStatus !== 'ok' ? (
                      <Badge tone="danger">{tc.bounced}</Badge>
                    ) : null}
                  </div>
                  <p className="text-[13px] text-muted">
                    {[
                      contact.position,
                      contact.unsubscribedAt
                        ? tc.unsubscribedOn(formatDate(contact.unsubscribedAt))
                        : contact.salutation
                          ? tc.salutationOf(contact.salutation)
                          : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4 text-[13px]">
                    {contact.email ? (
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-primary-text hover:underline"
                      >
                        {contact.email}
                      </a>
                    ) : null}
                    {contact.phone ? <span className="text-muted">{contact.phone}</span> : null}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" aria-label={tc.menu(name)}>
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(contact)}>
                      {tc.edit}
                    </DropdownMenuItem>
                    {contact.isPrimary ? null : (
                      <DropdownMenuItem onSelect={() => primary.mutate({ id: contact.id })}>
                        {tc.makePrimary}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setRemoving(contact)}>
                      {tc.dialog.delete}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
      {editing ? (
        <ContactDialog
          customerId={c.id}
          customerName={c.name}
          contact={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => setRemoving(editing)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={tc.deleteConfirm.title(personName(removing))}
          description={tc.deleteConfirm.text}
          confirmLabel={tc.deleteConfirm.confirm}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ id: removing.id })}
        />
      ) : null}
    </Card>
  );
}

type HistoryEvent = RouterOutputs['customer']['history'][number];

const isStatus = (value: unknown): value is CustomerStatus =>
  typeof value === 'string' && (CUSTOMER_STATUSES as readonly string[]).includes(value);

/** What one audit event says, in a sentence of the app's own words. */
function describe(event: HistoryEvent): ReactNode {
  const h = t.history;
  const diff = event.diff ?? {};
  const status = diff.status as { before?: unknown; after?: unknown } | undefined;
  const statusChange =
    status && isStatus(status.after) ? (
      <>
        {h.status}
        {isStatus(status.before) ? (
          <>
            {' '}
            <CustomerStatusBadge status={status.before} /> →
          </>
        ) : null}{' '}
        <CustomerStatusBadge status={status.after} />
      </>
    ) : null;
  const fieldList = Array.isArray(diff.fields)
    ? [
        ...new Set(
          (diff.fields as string[]).map(
            (field) => (h.fieldNames as Record<string, string>)[field] ?? field,
          ),
        ),
      ].join(', ')
    : '';
  switch (event.action) {
    case 'customer.create':
      return h.created;
    case 'customer.delete':
      return h.deleted;
    case 'customer.bulkAddTag':
      return h.tagAdded;
    case 'customer.bulkSetStatus':
      return statusChange ?? h.status;
    case 'customer.exportCsv':
      return h.exported;
    case 'customer.contactCreate':
      return h.contactCreated;
    case 'customer.contactUpdate':
      return fieldList ? `${h.contactUpdated}: ${fieldList}` : h.contactUpdated;
    case 'customer.contactSetPrimary':
      return h.contactPrimary;
    case 'customer.contactDelete':
      return h.contactDeleted;
    case 'customer.update': {
      const parts: ReactNode[] = [];
      if (statusChange) parts.push(<span key="s">{statusChange}</span>);
      if (diff.ownerUserId) parts.push(<span key="o">{h.owner}</span>);
      if (fieldList) parts.push(<span key="f">{h.updated(fieldList)}</span>);
      return parts.length > 0 ? (
        <span className="flex flex-col gap-1">{parts}</span>
      ) : (
        h.updatedPlain
      );
    }
    default:
      return event.action;
  }
}

/** Who changed what and when: the customer's audit trail, newest first. */
function HistoryCard({ customerId }: { customerId: string }) {
  const history = useQuery(trpc.customer.history.queryOptions({ id: customerId }));
  return (
    <Card>
      <CardHeader title={t.history.title} />
      <div className="px-5 pt-2 pb-4">
        {history.isPending ? (
          <p className="text-sm text-muted">{sk.common.loading}</p>
        ) : loadFailed(history) ? (
          <ErrorState onRetry={() => void history.refetch()} />
        ) : history.data.length === 0 ? (
          <p className="text-sm text-muted">{t.history.empty}</p>
        ) : (
          <ol className="relative space-y-4 border-l border-border-subtle pl-5">
            {history.data.map((event) => (
              <li key={event.id} className="relative">
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-primary ring-4 ring-white"
                />
                <div className="text-sm">{describe(event)}</div>
                <p className="text-xs text-muted">
                  {t.history.by(event.userName ?? sk.common.none, formatRecent(event.at))}
                </p>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-xs text-muted">
          {t.comingSoon.timeline}
        </p>
      </div>
    </Card>
  );
}

function DeleteCustomer({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const c = t.deleteConfirm;
  const remove = useMutation(
    trpc.customer.delete.mutationOptions({
      onSuccess: async () => {
        toast('success', c.done);
        await queryClient.invalidateQueries(trpc.customer.list.pathFilter());
        await navigate({ to: '/customers' });
      },
      onError: (error) => {
        toast('error', errorMessage(error, sk.customers.errors));
        onClose();
      },
    }),
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={c.title(customer.name)}
      description={c.text}
      confirmLabel={c.confirm}
      destructive
      pending={remove.isPending}
      onConfirm={() => remove.mutate({ id: customer.id })}
    />
  );
}
