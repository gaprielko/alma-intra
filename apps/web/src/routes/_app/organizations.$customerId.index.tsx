import { sk } from '@intra/shared/i18n';
import {
  CUSTOMER_STATUSES,
  type CustomerStatus,
  type RichText,
  TIMELINE_FILTERS,
  type TimelineFilter,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Mail, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ActivityDialog } from '@/components/activities/activity-dialog';
import { ActivitySheet } from '@/components/activities/activity-sheet';
import { ActivityItem, EmailItem, ReplyItem } from '@/components/activities/timeline-items';
import { Avatar } from '@/components/avatar';
import { AttachDialog } from '@/components/customers/attach-dialog';
import { EstablishmentDialog } from '@/components/customers/establishment-dialog';
import { EstablishmentChip, EstablishmentsCard } from '@/components/customers/establishments-card';
import { HoldingsCard } from '@/components/customers/holdings-card';
import { PersonsTable } from '@/components/customers/persons-table';
import { CustomerStatusBadge, ProductChip, TagChip } from '@/components/customers/customer-bits';
import { CreateDocumentDialog } from '@/components/documents/create-document-dialog';
import { ErrorState } from '@/components/empty-state';
import { CustomerFilesCard } from '@/components/files/customer-files-card';
import { PageHeader } from '@/components/page-header';
import { RichTextEditor } from '@/components/rich-text';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan, useSession } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/organizations/$customerId/')({
  component: CustomerDetailPage,
});

const t = sk.customers.detail;
const f = t.fields;
type Customer = RouterOutputs['customer']['get'];

function CustomerDetailPage() {
  const { customerId } = Route.useParams();
  const customer = useQuery(trpc.customer.get.queryOptions({ id: customerId }));
  const [deleting, setDeleting] = useState(false);
  const [changingRole, setChangingRole] = useState(false);
  const [documenting, setDocumenting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [addingEstablishment, setAddingEstablishment] = useState(false);
  const [editingEstablishment, setEditingEstablishment] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const canRecord = useCan('activity.write');
  const canSend = useCan('email.send');
  const navigateTo = useNavigate();
  const composeToast = useToast();
  const compose = useMutation(
    trpc.campaign.create.mutationOptions({
      onSuccess: (created) =>
        navigateTo({ to: '/emails/compose/$campaignId', params: { campaignId: created.id } }),
      onError: (error) => composeToast('error', errorMessage(error, sk.campaigns.errors)),
    }),
  );

  if (customer.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader
          title={sk.common.loading}
          back={{ to: '/organizations/customers', label: t.back }}
        />
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
        <PageHeader
          title={sk.customers.title}
          back={{ to: '/organizations/customers', label: t.back }}
        />
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
  const parent = c.parent;
  const status = parent ? parent.status : c.status;

  return (
    <div className="min-w-0">
      <PageHeader
        title={c.name}
        subtitle={<HeaderFacts customer={c} />}
        back={
          parent
            ? {
                to: '/organizations/$customerId',
                params: { customerId: parent.id },
                label: parent.name,
              }
            : {
                to: c.role === 'partner' ? '/organizations/partners' : '/organizations/customers',
                label:
                  c.role === 'partner'
                    ? sk.organizations.tabs.partners
                    : sk.organizations.tabs.customers,
              }
        }
        badge={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{sk.organizations.persons.roles[c.role]}</Badge>
            {parent ? <EstablishmentChip name={sk.establishments.badge} /> : null}
            {status ? <CustomerStatusBadge status={status} /> : null}
          </span>
        }
      >
        {/* One row: the title side wraps first, the buttons stay together. */}
        <div className="flex flex-nowrap items-center gap-3">
          {canSend ? (
            <Button
              variant="secondary"
              disabled={compose.isPending}
              onClick={() => compose.mutate({ customerIds: [customerId] })}
            >
              <Mail className="size-4" aria-hidden />
              {sk.campaigns.sendEmail}
            </Button>
          ) : null}
          {canRecord ? (
            <Button onClick={() => setRecording(true)}>
              <Plus className="size-4" aria-hidden />
              {a.record}
            </Button>
          ) : null}
          {parent ? (
            <Button variant="secondary" onClick={() => setEditingEstablishment(true)}>
              <Pencil className="size-4" aria-hidden />
              {t.edit}
            </Button>
          ) : (
            <Button variant="secondary" asChild>
              <Link to="/organizations/$customerId/edit" params={{ customerId }}>
                <Pencil className="size-4" aria-hidden />
                {t.edit}
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" aria-label={t.more}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {parent ? null : (
                <DropdownMenuItem onSelect={() => setChangingRole(true)}>
                  {c.role === 'customer'
                    ? sk.organizations.roleChange.toPartner
                    : sk.organizations.roleChange.toCustomer}
                </DropdownMenuItem>
              )}
              {!parent && c.kind === 'organization' ? (
                <DropdownMenuItem onSelect={() => setAddingEstablishment(true)}>
                  {sk.establishments.add}
                </DropdownMenuItem>
              ) : null}
              {!parent && c.kind === 'organization' && !c.ico && c.establishmentCount === 0 ? (
                <DropdownMenuItem onSelect={() => setAttaching(true)}>
                  {sk.establishments.attach.menu}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setDocumenting(true)}>
                {sk.documents.menu}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                {parent ? sk.establishments.delete : t.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <OwnerLine
          owner={(parent ?? c).owner?.name ?? null}
          source={parent ? null : c.sourceName}
        />
      </PageHeader>

      <main className="grid max-w-[1400px] items-start gap-5 px-7 pt-5 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="min-w-0 space-y-5">
          {!parent && c.establishmentCount > 0 ? (
            <EstablishmentsCard parentId={c.id} parentName={c.name} />
          ) : null}
          <HoldingsCard
            customerId={c.id}
            customerName={c.name}
            isEstablishment={parent !== null && parent !== undefined}
            withVat={c.pricesWithVat}
          />
          {c.kind === 'organization' ? (
            <PersonsTable
              organizationId={c.id}
              organizationName={c.name}
              hasEstablishments={!parent && c.establishmentCount > 0}
            />
          ) : (
            <PersonCard customer={c} />
          )}
          <NoteCard customer={c} />
          {parent ? null : <CustomerFilesCard customerId={customerId} />}
        </div>
        <div className="min-w-0 space-y-5">
          <TimelineCard customer={c} />
        </div>
      </main>

      {deleting ? <DeleteCustomer customer={c} onClose={() => setDeleting(false)} /> : null}
      {changingRole ? <ChangeRole customer={c} onClose={() => setChangingRole(false)} /> : null}
      {documenting ? (
        <CreateDocumentDialog customer={c} onClose={() => setDocumenting(false)} />
      ) : null}
      {attaching ? (
        <AttachDialog
          organizationId={c.id}
          organizationName={c.name}
          onClose={() => setAttaching(false)}
        />
      ) : null}
      {addingEstablishment ? (
        <EstablishmentDialog
          parentId={c.id}
          parentName={c.name}
          onClose={() => setAddingEstablishment(false)}
        />
      ) : null}
      {editingEstablishment && parent ? (
        <EstablishmentDialog
          parentId={parent.id}
          parentName={parent.name}
          establishment={c}
          onClose={() => setEditingEstablishment(false)}
        />
      ) : null}
      {recording ? (
        <ActivityDialog
          customerId={customerId}
          customerName={c.name}
          onClose={() => setRecording(false)}
        />
      ) : null}
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

const h = sk.establishments.header;
const formatIco = (ico: string) => ico.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1 $2 $3');

/** One fact of the header: a muted label and its value. */
function Fact({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <span className="text-foreground">
      {label ? <span className="mr-1 text-muted">{label}</span> : null}
      {children}
    </span>
  );
}

/**
 * The record's data under its name (docs/establishments.md 4): a line of IČO, DIČ, seat, phone,
 * e-mail and web, and a little apart the products and the number of prevádzky. A prevádzka shows
 * its address and its organization instead.
 */
function HeaderFacts({ customer: c }: { customer: Customer }) {
  const parent = c.parent;
  const where = address(c);
  const email = c.email ? (
    <a href={`mailto:${c.email}`} className="font-medium text-primary-text hover:underline">
      {c.email}
    </a>
  ) : null;
  const web = c.web ? (
    <a
      href={webHref(c.web)}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-primary-text hover:underline"
    >
      {c.web}
    </a>
  ) : null;
  return (
    <div className="max-w-[38rem] space-y-2 pt-1">
      <p className="flex flex-wrap gap-x-3.5 gap-y-0.5">
        {parent ? (
          <>
            {where ? <Fact label={h.address}>{where}</Fact> : null}
            {c.phone ? <Fact label={h.phone}>{c.phone}</Fact> : null}
            {email}
            {c.almaOrganizationId ? <Fact label={h.alma}>{c.almaOrganizationId}</Fact> : null}
          </>
        ) : (
          <>
            {c.ico ? <Fact label={h.ico}>{formatIco(c.ico)}</Fact> : null}
            {c.dic ? <Fact label={h.dic}>{c.dic}</Fact> : null}
            {where ? (
              <Fact label={c.kind === 'organization' ? h.seat : h.address}>{where}</Fact>
            ) : null}
            {c.phone ? <Fact label={h.phone}>{c.phone}</Fact> : null}
            {email}
            {web}
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {c.products.length > 0 ? (
          <span className="inline-flex flex-wrap gap-1">
            {c.products.map((product) => (
              <ProductChip key={product.id}>{product.name}</ProductChip>
            ))}
          </span>
        ) : null}
        {parent ? (
          <>
            <Fact label={h.organization}>
              <Link
                to="/organizations/$customerId"
                params={{ customerId: parent.id }}
                className="font-medium text-primary-text hover:underline"
              >
                {parent.name}
              </Link>
            </Fact>
            {parent.ico ? <Fact label={h.ico}>{formatIco(parent.ico)}</Fact> : null}
          </>
        ) : c.establishmentCount > 0 ? (
          <Fact label={h.establishments}>{c.establishmentCount}</Fact>
        ) : null}
        {c.nurses !== null ? <Fact label={h.nurses}>{c.nurses}</Fact> : null}
        {parent ? (
          parent.tags.map((tag) => <TagChip key={tag.id}>{tag.name}</TagChip>)
        ) : (
          <TagsQuickAdd customer={c} />
        )}
      </div>
    </div>
  );
}

/** Under the header's buttons: who has the record in hand and where it came from. */
function OwnerLine({ owner, source }: { owner: string | null; source: string | null }) {
  if (!owner && !source) return null;
  return (
    <p className="flex basis-full flex-wrap justify-end gap-x-3.5 text-[13px] text-muted">
      {owner ? <Fact label={h.owner}>{owner}</Fact> : null}
      {source ? <Fact label={h.source}>{source}</Fact> : null}
    </p>
  );
}

/** The note and the few things not in the header; a prevádzka points to its organization's files. */
function NoteCard({ customer: c }: { customer: Customer }) {
  const e = sk.establishments.detail;
  return (
    <Card>
      <CardHeader title={sk.establishments.noteCard} />
      <Rows>
        <Row label={f.note}>
          {c.note ? <span className="whitespace-pre-line">{c.note}</span> : null}
        </Row>
        {c.kind === 'organization' && !c.parent ? (
          <Row label={f.almaId}>{c.almaOrganizationId}</Row>
        ) : null}
        {c.kind === 'organization' && !c.parent ? (
          <Row label={f.region}>{c.region ? sk.customers.region[c.region] : null}</Row>
        ) : null}
        <Row label={f.created}>
          {c.createdBy
            ? t.createdBy(formatDate(c.createdAt), c.createdBy)
            : formatDate(c.createdAt)}
        </Row>
      </Rows>
      {c.parent ? (
        <p className="px-5 pb-5 text-[13px] text-muted">
          {e.files}{' '}
          <Link
            to="/organizations/$customerId"
            params={{ customerId: c.parent.id }}
            className="font-semibold text-primary-text hover:underline"
          >
            {e.openFolder(c.parent.name)}
          </Link>
        </p>
      ) : null}
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

function PersonCard({ customer: c }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader
        title={t.personal}
        action={
          c.personId ? (
            <Button variant="secondary" size="sm" asChild>
              <Link to="/contacts/$personId" params={{ personId: c.personId }}>
                {sk.organizations.openPerson}
              </Link>
            </Button>
          ) : null
        }
      />
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

type HistoryEvent = RouterOutputs['customer']['history'][number];

const a = sk.activities;

const isStatus = (value: unknown): value is CustomerStatus =>
  typeof value === 'string' && (CUSTOMER_STATUSES as readonly string[]).includes(value);

/** What one audit event says, in a sentence of the app's own words. */
function describe(event: HistoryEvent): ReactNode {
  const h = t.history;
  const diff = event.diff ?? {};
  // Names come with the event, resolved when the history is read; an id without one (deleted
  // since) is left out.
  const nameOf = (id: unknown) => (typeof id === 'string' ? (event.names[id] ?? null) : null);
  const namesOf = (ids: unknown) =>
    Array.isArray(ids) ? ids.map(nameOf).filter((n): n is string => n !== null) : [];
  const change = (key: string) => {
    const value = diff[key] as { before?: unknown; after?: unknown } | undefined;
    if (!value) return null;
    const before = nameOf(value.before) ?? h.none;
    const after = nameOf(value.after) ?? h.none;
    return `${before} → ${after}`;
  };
  const named = (text: string, id: unknown) => (nameOf(id) ? `${text}: ${nameOf(id)}` : text);
  const contactName = nameOf(diff.contactId);
  const withContact = (text: string) => (contactName ? `${text}: ${contactName}` : text);
  const added = namesOf(diff.tagsAdded);
  const removed = namesOf(diff.tagsRemoved);
  const tagDetail = [...added.map((n) => `+ ${n}`), ...removed.map((n) => `− ${n}`)].join(', ');
  const productsAdded = namesOf(diff.productsAdded);
  const productDetail = [
    ...productsAdded.map((n) => `+ ${n}`),
    ...namesOf(diff.productsRemoved).map((n) => `− ${n}`),
  ].join(', ');
  const status = diff.status as { before?: unknown; after?: unknown } | undefined;
  // Set, changed or cleared (the type is no longer „Zákazník“, or „Bez zaradenia“ was picked).
  const statusChange =
    status && (isStatus(status.after) || isStatus(status.before)) ? (
      <>
        {h.status}
        {isStatus(status.before) ? (
          <>
            {' '}
            <CustomerStatusBadge status={status.before} /> →
          </>
        ) : null}{' '}
        {isStatus(status.after) ? <CustomerStatusBadge status={status.after} /> : h.none}
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
      return [
        h.created,
        productsAdded.length > 0 ? `${h.fieldNames.products}: ${productsAdded.join(', ')}` : null,
        added.length > 0 ? `${h.fieldNames.tags}: ${added.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'customer.delete':
      return diff.establishment === 'deleted'
        ? named(h.establishmentDeleted, diff.establishmentId)
        : h.deleted;
    case 'customer.establishmentCreate':
      return named(h.establishmentCreated, diff.establishmentId);
    case 'customer.establishmentAttach':
      return named(h.establishmentAttached, diff.establishmentId);
    case 'customer.establishmentUpdate':
      return fieldList
        ? `${named(h.establishmentUpdated, diff.establishmentId)} (${fieldList})`
        : named(h.establishmentUpdated, diff.establishmentId);
    case 'customer.holdingSave':
      return named(diff.holding === 'added' ? h.holdingAdded : h.holdingChanged, diff.productId);
    case 'customer.holdingEnd':
      return named(h.holdingEnded, diff.productId);
    case 'customer.bulkAddTag':
      return nameOf(diff.tagId) ? `${h.tagAdded}: ${nameOf(diff.tagId)}` : h.tagAdded;
    case 'customer.bulkSetStatus':
      return statusChange ?? h.status;
    case 'customer.exportCsv':
      return h.exported;
    case 'customer.contactCreate':
      return withContact(h.contactCreated);
    case 'customer.contactUpdate':
      return fieldList
        ? `${withContact(h.contactUpdated)} (${fieldList})`
        : withContact(h.contactUpdated);
    case 'customer.contactSetPrimary':
      return withContact(h.contactPrimary);
    case 'customer.contactDelete':
      return withContact(h.contactDeleted);
    case 'customer.update': {
      const parts: ReactNode[] = [];
      if (statusChange) parts.push(<span key="s">{statusChange}</span>);
      if (diff.ownerUserId) {
        parts.push(<span key="o">{`${h.owner}: ${change('ownerUserId') ?? ''}`}</span>);
      }
      const details = [
        diff.contactTypeId ? `${h.fieldNames.contactTypeId}: ${change('contactTypeId')}` : null,
        productDetail ? `${h.fieldNames.products}: ${productDetail}` : null,
        diff.sourceId ? `${h.fieldNames.sourceId}: ${change('sourceId')}` : null,
        tagDetail ? `${h.fieldNames.tags}: ${tagDetail}` : null,
      ].filter(Boolean);
      if (fieldList) {
        parts.push(
          <span key="f">
            {h.updated(fieldList)}
            {details.length > 0 ? ` · ${details.join(' · ')}` : null}
          </span>,
        );
      }
      return parts.length > 0 ? (
        <span className="flex flex-col gap-1">{parts}</span>
      ) : (
        h.updatedPlain
      );
    }
    // The public unsubscribe page and the one-click header: the person, by the link in an e-mail.
    case 'unsubscribe.confirm':
    case 'unsubscribe.oneClick':
      return withContact(h.unsubscribed);
    case 'unsubscribe.undo':
      return withContact(h.resubscribed);
    default:
      return event.action;
  }
}

/**
 * The customer's timeline: activities and notes with the changes from the audit trail, newest
 * first, filtered by kind; a note is written right at its top. Sent e-mails join it with E5.
 */
const WITH_ESTABLISHMENTS_KEY = 'intra.timeline.withEstablishments';
type TimelineItem = RouterOutputs['activity']['timeline'][number];
const keyOf = (item: TimelineItem) =>
  item.type === 'activity'
    ? item.activity.id
    : item.type === 'email'
      ? item.email.id
      : item.type === 'reply'
        ? item.reply.id
        : item.change.id;

function TimelineCard({ customer }: { customer: Customer }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCan('activity.write');
  const me = useSession((state) => state.user);
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState<RichText | null>(null);
  const [noteKey, setNoteKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  // „Aj prevádzky“ (P-7): on by default, remembered in this browser.
  const hasEstablishments = !customer.parent && customer.establishmentCount > 0;
  const [withEstablishments, setWithEstablishments] = useState(() => {
    try {
      return localStorage.getItem(WITH_ESTABLISHMENTS_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const toggleEstablishments = () => {
    const next = !withEstablishments;
    setWithEstablishments(next);
    try {
      localStorage.setItem(WITH_ESTABLISHMENTS_KEY, next ? 'on' : 'off');
    } catch {
      // A private window: the choice lasts this page only.
    }
  };
  const timeline = useQuery({
    ...trpc.activity.timeline.queryOptions({
      customerId: customer.id,
      filter,
      withEstablishments: hasEstablishments && withEstablishments,
    }),
    placeholderData: keepPreviousData,
  });
  // A prevádzka's entry is indented under its name (docs/establishments.md 4.3).
  const holderOf = (item: TimelineItem) =>
    item.type === 'activity'
      ? item.activity.organization
      : item.type === 'email'
        ? item.email.organization
        : item.type === 'reply'
          ? item.reply.organization
          : item.change.organization;
  const establishmentName = (item: TimelineItem) => {
    const holder = holderOf(item);
    return holder && holder.id !== customer.id ? holder.name : null;
  };
  const saveNote = useMutation(
    trpc.activity.create.mutationOptions({
      onSuccess: async () => {
        toast('success', a.timeline.quickNoteSaved);
        setNote(null);
        setNoteOpen(false);
        setNoteKey((key) => key + 1);
        await Promise.all([
          queryClient.invalidateQueries(trpc.activity.pathFilter()),
          queryClient.invalidateQueries(trpc.customer.list.pathFilter()),
        ]);
      },
      onError: (error) => toast('error', errorMessage(error, a.errors)),
    }),
  );

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {a.timeline.title}
            {canWrite ? (
              <Button
                variant="secondary"
                size="icon"
                className="size-7"
                aria-label={a.record}
                onClick={() => setRecording(true)}
              >
                <Plus className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </span>
        }
        action={
          hasEstablishments ? (
            <span className="flex items-center gap-2 text-[13px] font-medium text-muted">
              {a.timeline.withEstablishments}
              <Switch
                checked={withEstablishments}
                label={a.timeline.withEstablishments}
                onChange={toggleEstablishments}
              />
            </span>
          ) : null
        }
      />
      <div className="px-5 pt-3 pb-4">
        <div
          role="tablist"
          aria-label={a.timeline.filters.label}
          className="flex flex-wrap gap-1.5"
        >
          {TIMELINE_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors',
                filter === key
                  ? 'border-primary bg-primary-soft text-primary-text'
                  : 'border-border bg-white text-muted hover:bg-hover',
              )}
            >
              {a.timeline.filters[key]}
            </button>
          ))}
        </div>

        {canWrite && (filter === 'all' || filter === 'notes') ? (
          <div className="mt-4 flex items-start gap-3">
            <Avatar name={me?.name ?? ''} size={32} />
            {noteOpen ? (
              <div className="min-w-0 flex-1 space-y-2">
                <RichTextEditor
                  key={noteKey}
                  value={note}
                  onChange={setNote}
                  placeholder={a.timeline.quickNote}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
                    {sk.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!note || saveNote.isPending}
                    onClick={() =>
                      note &&
                      saveNote.mutate({
                        customerId: customer.id,
                        activity: { kind: 'note', occurredAt: new Date(), body: note },
                      })
                    }
                  >
                    {a.timeline.quickNoteSave}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="h-9 min-w-0 flex-1 rounded-[10px] border border-border px-3 text-left text-sm text-tertiary hover:border-primary"
              >
                {a.timeline.quickNote}
              </button>
            )}
          </div>
        ) : null}

        <div className="mt-4">
          {timeline.isPending ? (
            <p className="text-sm text-muted">{sk.common.loading}</p>
          ) : loadFailed(timeline) ? (
            <ErrorState compact onRetry={() => void timeline.refetch()} />
          ) : timeline.data.length === 0 ? (
            <p className="py-2 text-sm text-muted">
              {filter === 'emails' ? a.timeline.emptyEmails : a.timeline.empty}
            </p>
          ) : (
            <ol
              className={cn(
                'relative space-y-5 border-l border-border-subtle pl-6',
                timeline.isPlaceholderData && 'opacity-60',
              )}
            >
              {timeline.data.map((item) => {
                const entry =
                  item.type === 'activity' ? (
                    <ActivityItem
                      key={item.activity.id}
                      item={item.activity}
                      onOpen={() => setOpenId(item.activity.id)}
                    />
                  ) : item.type === 'email' ? (
                    <EmailItem key={item.email.id} item={item.email} />
                  ) : item.type === 'reply' ? (
                    <ReplyItem key={item.reply.id} item={item.reply} />
                  ) : (
                    <li key={item.change.id} className="relative">
                      <span
                        aria-hidden
                        className="absolute top-1.5 -left-[29px] size-2 rounded-full bg-border ring-4 ring-white"
                      />
                      <div className="text-sm">{describe(item.change)}</div>
                      <p className="text-xs text-muted">
                        {t.history.by(
                          item.change.userName ?? sk.common.none,
                          formatRecent(item.change.at),
                        )}
                      </p>
                    </li>
                  );
                const at = establishmentName(item);
                return at ? (
                  <li
                    key={`est-${keyOf(item)}`}
                    className="relative ml-3 border-l-2 border-warning-soft pl-3"
                  >
                    <EstablishmentChip name={at} className="mb-1.5" />
                    <ol className="relative">{entry}</ol>
                  </li>
                ) : (
                  entry
                );
              })}
            </ol>
          )}
        </div>
      </div>
      {openId ? <ActivitySheet activityId={openId} onClose={() => setOpenId(null)} /> : null}
      {recording ? (
        <ActivityDialog
          customerId={customer.id}
          customerName={customer.name}
          onClose={() => setRecording(false)}
        />
      ) : null}
    </Card>
  );
}

/** „Zmeniť na zákazníka“ / „Zmeniť na partnera“ (D-5), asked first: a partner loses status, owner and products. */
function ChangeRole({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const r = sk.organizations.roleChange;
  const toast = useToast();
  const queryClient = useQueryClient();
  const toPartner = customer.role === 'customer';
  const change = useMutation(
    trpc.customer.setRole.mutationOptions({
      onSuccess: async () => {
        toast('success', r.done);
        await queryClient.invalidateQueries(trpc.customer.pathFilter());
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, sk.customers.errors)),
    }),
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={toPartner ? r.partnerTitle : r.customerTitle}
      description={toPartner ? r.partnerText : r.customerText}
      confirmLabel={toPartner ? r.toPartner : r.toCustomer}
      destructive={toPartner}
      pending={change.isPending}
      onConfirm={() => change.mutate({ id: customer.id, role: toPartner ? 'partner' : 'customer' })}
    />
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
        await navigate({ to: '/organizations/customers' });
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
