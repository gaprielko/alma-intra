import { sk } from '@intra/shared/i18n';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Lock, Mail, MoreHorizontal, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ActivityDialog } from '@/components/activities/activity-dialog';
import { ActivitySheet } from '@/components/activities/activity-sheet';
import {
  ActivityItem,
  EmailItem,
  InterestItem,
  ReplyItem,
} from '@/components/activities/timeline-items';
import { CustomerAvatar, placeName } from '@/components/customers/customer-bits';
import { PersonDialog } from '@/components/customers/person-dialog';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/contacts/$personId')({ component: PersonPage });

const p = sk.organizations.persons;
type Person = RouterOutputs['person']['get'];
type Organization = Person['organizations'][number];

/** Kontakty › a person: where they work, their own data and their own timeline (D-8). */
function PersonPage() {
  const { personId } = Route.useParams();
  const person = useQuery(trpc.person.get.queryOptions({ id: personId }));
  const canWrite = useCan('customer.write');
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const canSend = useCan('email.send');
  const canRecord = useCan('activity.write');
  const toast = useToast();
  const navigate = useNavigate();
  const setRecipients = useMutation(trpc.campaign.setRecipients.mutationOptions());
  // An e-mail to this person: a draft for their organization with them as the one recipient.
  const compose = useMutation(
    trpc.campaign.create.mutationOptions({
      onSuccess: async (created, input) => {
        await setRecipients.mutateAsync({
          id: created.id,
          recipients: [{ customerId: input.customerIds?.[0] ?? '', contactId: personId }],
        });
        await navigate({ to: '/emails/compose/$campaignId', params: { campaignId: created.id } });
      },
      onError: (error) => toast('error', errorMessage(error, sk.campaigns.errors)),
    }),
  );
  const back = { to: '/organizations/contacts' as const, label: p.back };

  if (person.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader title={sk.common.loading} back={back} />
        <div className="p-7">
          <CardSkeleton lines={6} />
        </div>
      </div>
    );
  }
  if (loadFailed(person)) {
    return (
      <div className="min-w-0">
        <PageHeader title={p.back} back={back} />
        <ErrorState
          text={errorMessage(person.error, p.errors)}
          onRetry={() => void person.refetch()}
        />
      </div>
    );
  }
  const c = person.data;
  const own = c.organizations.find((o) => o.kind === 'individual');
  // The organization an e-mail or an activity from here belongs to: the primary one, else the first.
  const home = c.organizations[0];
  const subtitle = c.organizations
    .filter((o) => o.kind === 'organization')
    .map((o) => p.positionAt(o.position, placeName(o)))
    .join(' · ');

  return (
    <div className="min-w-0">
      <PageHeader
        title={c.name}
        subtitle={subtitle || undefined}
        back={back}
        badge={
          c.userId ? (
            <Link to="/settings/users">
              <Badge tone="info">{p.fromUser.badge}</Badge>
            </Link>
          ) : undefined
        }
      >
        {canWrite && !own ? (
          <Button variant="ghost" onClick={() => setDeleting(true)}>
            {p.delete}
          </Button>
        ) : null}
        {canSend && home ? (
          <Button
            variant="secondary"
            disabled={compose.isPending}
            onClick={() => compose.mutate({ customerIds: [home.id] })}
          >
            <Mail className="size-4" aria-hidden />
            {sk.campaigns.sendEmail}
          </Button>
        ) : null}
        {canRecord && home ? (
          <Button onClick={() => setRecording(true)}>
            <Plus className="size-4" aria-hidden />
            {sk.activities.record}
          </Button>
        ) : null}
        {canWrite ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {p.dialog.edit}
          </Button>
        ) : null}
      </PageHeader>
      <div className="flex flex-wrap items-start gap-5 px-7 pt-6 pb-10">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-5">
          <PersonTimeline person={c} />
        </div>
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          <PersonalCard person={c} />
          <OrganizationsCard person={c} />
        </div>
      </div>
      {deleting ? <DeletePerson person={c} onClose={() => setDeleting(false)} /> : null}
      {editing ? <PersonDialog person={c} onClose={() => setEditing(false)} /> : null}
      {recording && home ? (
        <ActivityDialog
          customerId={home.id}
          customerName={home.name}
          contact={{ id: c.id, name: c.name }}
          onClose={() => setRecording(false)}
        />
      ) : null}
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border-subtle px-5 pt-2 pb-4">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function PersonalCard({ person: c }: { person: Person }) {
  const f = p.fields;
  return (
    <Card>
      <CardHeader title={p.personal} />
      {c.userId ? (
        <p className="mx-5 mt-2 flex items-start gap-1.5 text-xs leading-[17px] text-muted">
          <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {p.fromUser.noteShort}{' '}
            <Link to="/settings/users" className="font-semibold text-primary-text hover:underline">
              {p.fromUser.link}
            </Link>
          </span>
        </p>
      ) : null}
      <Rows>
        <Row label={f.name}>{c.name}</Row>
        {c.gender ? <Row label={f.form}>{sk.contacts.dialog[c.gender]}</Row> : null}
        {c.salutation ? <Row label={f.salutation}>{c.salutation}</Row> : null}
        <Row label={f.email}>
          {c.email ? (
            <a href={`mailto:${c.email}`} className="text-primary-text hover:underline">
              {c.email}
            </a>
          ) : (
            sk.common.none
          )}
        </Row>
        <Row label={f.phone}>{c.phone ?? sk.common.none}</Row>
        <Row label={f.bulk}>{c.unsubscribedAt ? f.bulkOff : f.bulkOn}</Row>
        {c.note ? <Row label={f.note}>{c.note}</Row> : null}
      </Rows>
    </Card>
  );
}

function OrganizationsCard({ person: c }: { person: Person }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCan('customer.write');
  const [linking, setLinking] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.person.pathFilter()),
      queryClient.invalidateQueries(trpc.customer.pathFilter()),
    ]);
  const unlink = useMutation(
    trpc.person.unlink.mutationOptions({
      onSuccess: async () => {
        toast('success', p.unlinked);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error, p.errors)),
    }),
  );
  const primary = useMutation(
    trpc.person.link.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast('error', errorMessage(error, p.errors)),
    }),
  );
  const own = c.organizations.some((o) => o.kind === 'individual');
  return (
    <Card>
      <CardHeader
        title={`${p.organizationsCard} · ${c.organizations.length}`}
        action={
          canWrite && !own ? (
            <Button variant="secondary" size="sm" onClick={() => setLinking(true)}>
              <Plus className="size-3.5" aria-hidden />
              {p.assign}
            </Button>
          ) : null
        }
      />
      <div className="mt-3 pb-2">
        {c.organizations.length === 0 ? (
          <p className="px-5 pb-3 text-sm text-muted">{p.noOrganization}</p>
        ) : (
          c.organizations.map((org) => (
            <div
              key={org.id}
              className="flex items-start gap-3 border-t border-border-subtle px-5 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <RoleChip organization={org} />
                  <Link
                    to="/organizations/$customerId"
                    params={{ customerId: org.id }}
                    className="font-semibold text-primary-text hover:underline"
                  >
                    {placeName(org)}
                  </Link>
                </p>
                <p className="mt-1 text-xs text-muted">
                  {[org.position, org.isPrimary ? p.primary : null].filter(Boolean).join(' · ') ||
                    sk.common.none}
                </p>
              </div>
              {canWrite && org.kind === 'organization' ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${sk.common.actions} ${org.name}`}
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {org.isPrimary ? null : (
                      <DropdownMenuItem
                        onSelect={() =>
                          primary.mutate({
                            id: c.id,
                            customerId: org.id,
                            position: org.position ?? undefined,
                            isPrimary: true,
                          })
                        }
                      >
                        {p.makePrimary}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      destructive
                      onSelect={() => unlink.mutate({ id: c.id, customerId: org.id })}
                    >
                      {p.unlink}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ))
        )}
      </div>
      {linking ? <LinkDialog person={c} onClose={() => setLinking(false)} /> : null}
    </Card>
  );
}

export function RoleChip({
  organization: org,
}: {
  organization: Pick<Organization, 'role' | 'kind'>;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap',
        org.kind === 'individual'
          ? 'border border-border-subtle bg-subtle text-muted'
          : org.role === 'customer'
            ? 'bg-primary-soft text-primary-text'
            : 'bg-info-soft text-info',
      )}
    >
      {org.kind === 'individual' ? p.self(p.roles[org.role]) : p.roles[org.role]}
    </span>
  );
}

/** „Priradiť k organizácii“: an organization (not a private person), the position, primary or not. */
function LinkDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const d = p.linkDialog;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [position, setPosition] = useState('');
  const [isPrimary, setPrimary] = useState(false);
  const options = useQuery(
    trpc.customer.list.queryOptions({ kind: ['organization'], pageSize: 100, sort: 'name' }),
  );
  const taken = new Set(person.organizations.map((o) => o.id));
  const link = useMutation(
    trpc.person.link.mutationOptions({
      onSuccess: async () => {
        toast('success', p.linked);
        await Promise.all([
          queryClient.invalidateQueries(trpc.person.pathFilter()),
          queryClient.invalidateQueries(trpc.customer.pathFilter()),
        ]);
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, p.errors)),
    }),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (customerId) {
              link.mutate({
                id: person.id,
                customerId,
                position: position.trim() || undefined,
                isPrimary,
              });
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="link-organization">{d.organization}</Label>
            <Select id="link-organization" value={customerId} onChange={setCustomerId}>
              <SelectItem value="">{d.pick}</SelectItem>
              {(options.data?.items ?? [])
                .filter((o) => !taken.has(o.id))
                .map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {`${o.name} · ${p.roles[o.role]}`}
                  </SelectItem>
                ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="link-position">{d.position}</Label>
            <Input
              id="link-position"
              maxLength={120}
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isPrimary} onChange={() => setPrimary(!isPrimary)} />
            {d.primary}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={!customerId || link.isPending}>
              {d.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TIMELINE_FILTERS = ['all', 'activities', 'interest', 'emails'] as const;

/** Only what concerns the person (D-8), each entry with its organization; filters by kind and organization. */
function PersonTimeline({ person: c }: { person: Person }) {
  const a = sk.activities;
  const [filter, setFilter] = useState<(typeof TIMELINE_FILTERS)[number]>('all');
  const [organization, setOrganization] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const timeline = useQuery({
    ...trpc.person.timeline.queryOptions({ id: c.id, filter }),
    placeholderData: keepPreviousData,
  });
  const items = (timeline.data ?? []).filter((item) => {
    if (!organization) return true;
    const org =
      item.type === 'activity'
        ? item.activity.organization
        : item.type === 'email'
          ? item.email.organization
          : item.type === 'reply'
            ? item.reply.organization
            : item.type === 'interest'
              ? item.interest.organization
              : null;
    return org?.id === organization;
  });
  const chip = (on: boolean) =>
    cn(
      'h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors',
      on
        ? 'border-primary bg-primary-soft text-primary-text'
        : 'border-border bg-white text-muted hover:bg-hover',
    );
  return (
    <Card>
      <CardHeader title={p.timeline} />
      <p className="px-5 pt-1 text-[13px] text-muted">{p.timelineLead}</p>
      <div className="px-5 pt-3 pb-4">
        <div className="flex flex-wrap gap-1.5">
          {TIMELINE_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={chip(filter === key)}
            >
              {a.timeline.filters[key]}
            </button>
          ))}
          {c.organizations.length > 1
            ? c.organizations.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  aria-pressed={organization === org.id}
                  onClick={() => setOrganization(organization === org.id ? '' : org.id)}
                  className={chip(organization === org.id)}
                >
                  {placeName(org)}
                </button>
              ))
            : null}
        </div>
        <div className="mt-4">
          {timeline.isPending ? (
            <p className="text-sm text-muted">{sk.common.loading}</p>
          ) : loadFailed(timeline) ? (
            <ErrorState compact onRetry={() => void timeline.refetch()} />
          ) : items.length === 0 ? (
            <p className="py-2 text-sm text-muted">{a.timeline.empty}</p>
          ) : (
            <ol
              className={cn('relative space-y-5 pl-6', timeline.isPlaceholderData && 'opacity-60')}
            >
              {items.map((item) =>
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
                ) : item.type === 'interest' ? (
                  <InterestItem key={item.interest.id} item={item.interest} />
                ) : null,
              )}
            </ol>
          )}
        </div>
      </div>
      {openId ? <ActivitySheet activityId={openId} onClose={() => setOpenId(null)} /> : null}
    </Card>
  );
}

function DeletePerson({ person, onClose }: { person: Person; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation(
    trpc.person.delete.mutationOptions({
      onSuccess: async () => {
        toast('success', p.deleted);
        await queryClient.invalidateQueries(trpc.person.pathFilter());
        await navigate({ to: '/organizations/contacts' });
      },
      onError: (error) => toast('error', errorMessage(error, p.errors)),
    }),
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={p.deleteConfirm.title}
      description={p.deleteConfirm.text}
      confirmLabel={p.deleteConfirm.confirm}
      pending={remove.isPending}
      onConfirm={() => remove.mutate({ id: person.id })}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <CustomerAvatar name={person.name} kind="individual" />
        {person.name}
      </p>
    </ConfirmDialog>
  );
}
