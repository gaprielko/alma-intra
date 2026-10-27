import { sk } from '@intra/shared/i18n';
import {
  CUSTOMER_STATUSES,
  type CustomerStatus,
  personName,
  type RichText,
  TIMELINE_FILTERS,
  type TimelineFilter,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Mail, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { formatDay, KindMark } from '@/components/activities/activity-bits';
import { ActivityDialog } from '@/components/activities/activity-dialog';
import { ActivitySheet } from '@/components/activities/activity-sheet';
import { Avatar } from '@/components/avatar';
import { ContactDialog, type Contact } from '@/components/customers/contact-dialog';
import { CustomerAvatar, CustomerStatusBadge, TagChip } from '@/components/customers/customer-bits';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan, useSession } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

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
  const [recording, setRecording] = useState(false);
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
          <TimelineCard customer={c} />
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

const a = sk.activities;

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

/**
 * The customer's timeline: activities and notes with the changes from the audit trail, newest
 * first, filtered by kind; a note is written right at its top. Sent e-mails join it with E5.
 */
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
  const timeline = useQuery({
    ...trpc.activity.timeline.queryOptions({ customerId: customer.id, filter }),
    placeholderData: keepPreviousData,
  });
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
        title={a.timeline.title}
        action={
          canWrite ? (
            <Button variant="secondary" size="sm" onClick={() => setRecording(true)}>
              <Plus className="size-3.5" aria-hidden />
              {a.record}
            </Button>
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
              {timeline.data.map((item) =>
                item.type === 'activity' ? (
                  <ActivityItem
                    key={item.activity.id}
                    item={item.activity}
                    onOpen={() => setOpenId(item.activity.id)}
                  />
                ) : item.type === 'email' ? (
                  <EmailItem key={item.email.id} item={item.email} />
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
                ),
              )}
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

type TimelineActivity = Extract<
  RouterOutputs['activity']['timeline'][number],
  { type: 'activity' }
>['activity'];

type TimelineEmail = Extract<
  RouterOutputs['activity']['timeline'][number],
  { type: 'email' }
>['email'];

/** A sent e-mail in the timeline: the subject, to whom, its delivery; opens the campaign. */
function EmailItem({ item }: { item: TimelineEmail }) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className="absolute top-0 -left-[41px] inline-flex size-7 items-center justify-center rounded-full bg-[#e9eef6] text-[#334e7b]"
      >
        <Mail className="size-3.5" />
      </span>
      <Link
        to="/emails/sent/$campaignId"
        params={{ campaignId: item.campaignId }}
        className="block rounded-lg hover:bg-hover/60"
      >
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {a.timeline.email(item.subject ?? '')}
          <Badge tone={EMAIL_TONE[item.status]} dot>
            {sk.campaigns.status[item.status]}
          </Badge>
        </p>
        <p className="text-xs text-muted">
          {a.timeline.emailBy(item.sender, item.toName ?? sk.common.none, formatRecent(item.at))}
        </p>
      </Link>
    </li>
  );
}

const EMAIL_TONE = {
  draft: 'neutral',
  skipped: 'neutral',
  queued: 'info',
  sent: 'info',
  delivered: 'success',
  bounced: 'danger',
  complained: 'danger',
  failed: 'danger',
} as const;

/** One activity in the timeline: its mark, a heading, who and when, the start of the notes. */
function ActivityItem({ item, onOpen }: { item: TimelineActivity; onOpen: () => void }) {
  const contacts = item.participants.filter((p) => p.kind === 'contact').map((p) => p.name);
  const heading = [
    item.subject ?? a.kinds[item.kind],
    item.kind === 'note' || contacts.length === 0 ? null : a.timeline.with(contacts.join(', ')),
    item.durationMin ? a.duration.format(item.durationMin) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="relative">
      <span className="absolute -left-[41px] top-0">
        <KindMark kind={item.kind} size="sm" />
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-lg text-left hover:bg-hover/60 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <p className="text-sm font-semibold">
          {item.subject ? `${a.kinds[item.kind]}: ` : ''}
          {heading}
        </p>
        <p className="text-xs text-muted">
          {a.timeline.by(item.author ?? sk.common.none, formatRecent(item.occurredAt))}
        </p>
        {item.bodyText ? (
          <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-foreground/90">
            {item.bodyText}
          </p>
        ) : null}
        {item.nextStepText ? (
          <p
            className={cn(
              'mt-1 text-[13px] font-medium',
              item.nextStepDoneAt ? 'text-muted line-through' : 'text-primary-text',
            )}
          >
            {item.nextStepDue
              ? a.timeline.nextStepDue(item.nextStepText, formatDay(item.nextStepDue))
              : a.timeline.nextStep(item.nextStepText)}
          </p>
        ) : null}
        {item.attachmentCount > 0 ? (
          <p className="mt-1 text-xs text-muted">{a.timeline.attachments(item.attachmentCount)}</p>
        ) : null}
      </button>
    </li>
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
