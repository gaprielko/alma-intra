import { sk } from '@intra/shared/i18n';
import type { CustomField, EmailNode, SkipReason } from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { EmailBodyEditor, EmailSubjectEditor } from '@/components/emails/email-editor';
import { ErrorState } from '@/components/empty-state';
import { FileBadge } from '@/components/files/file-bits';
import { FilePicker } from '@/components/files/file-picker';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatSize } from '@/lib/files';
import { formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useSession } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.campaigns;
const STEPS = ['recipients', 'template', 'content', 'preview', 'review'] as const;
type Step = (typeof STEPS)[number];

export const Route = createFileRoute('/_app/emails_/compose/$campaignId')({
  validateSearch: z.object({ step: z.enum(STEPS).optional() }),
  component: ComposePage,
});

type Campaign = RouterOutputs['campaign']['get'];
type Message = Campaign['messages'][number];

function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries(trpc.campaign.get.queryFilter({ id }));
}

function ComposePage() {
  const { campaignId } = Route.useParams();
  const { step = 'recipients' } = Route.useSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const campaign = useQuery(trpc.campaign.get.queryOptions({ id: campaignId }));
  const [discarding, setDiscarding] = useState(false);
  const discard = useMutation(
    trpc.campaign.deleteDraft.mutationOptions({
      onSuccess: async () => {
        toast('success', t.discardConfirm.done);
        await navigate({ to: '/emails/drafts' });
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const go = (next: Step) =>
    void navigate({
      to: '/emails/compose/$campaignId',
      params: { campaignId },
      search: { step: next },
    });

  if (campaign.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.title} back={{ to: '/emails/drafts', label: sk.emails.tabs.drafts }} />
        <div className="p-7">
          <CardSkeleton lines={8} />
        </div>
      </div>
    );
  }
  if (loadFailed(campaign)) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.title} back={{ to: '/emails/drafts', label: sk.emails.tabs.drafts }} />
        <ErrorState
          text={errorMessage(campaign.error, t.errors)}
          onRetry={() => void campaign.refetch()}
        />
      </div>
    );
  }
  const c = campaign.data;
  if (c.status !== 'draft') {
    return <Navigate to="/emails/sent/$campaignId" params={{ campaignId }} replace />;
  }
  const count = c.messages.length;
  const at = STEPS.indexOf(step);

  return (
    <div className="min-w-0">
      <PageHeader
        title={t.title}
        subtitle={c.templateName ? t.meta(c.templateName, count) : t.metaEmpty(count)}
        back={{ to: '/emails/drafts', label: sk.emails.tabs.drafts }}
      >
        <Button variant="ghost" onClick={() => setDiscarding(true)}>
          {t.discard}
        </Button>
      </PageHeader>
      <nav
        aria-label={t.steps.label}
        className="flex flex-wrap gap-2 border-b border-border px-7 py-3"
      >
        {STEPS.map((key, i) => (
          <button
            key={key}
            type="button"
            aria-current={key === step ? 'step' : undefined}
            onClick={() => go(key)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold transition-colors',
              key === step ? 'bg-primary-soft text-primary-text' : 'text-muted hover:bg-hover',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'inline-flex size-5 items-center justify-center rounded-full text-[11px]',
                i < at
                  ? 'bg-primary text-white'
                  : key === step
                    ? 'bg-primary text-white'
                    : 'bg-track',
              )}
            >
              {i < at ? <Check className="size-3" /> : i + 1}
            </span>
            {t.steps[key]}
          </button>
        ))}
      </nav>
      <main className="max-w-[1440px] px-7 pt-5 pb-10">
        {step === 'recipients' ? (
          <RecipientsStep campaign={c} onNext={() => go('template')} />
        ) : null}
        {step === 'template' ? (
          <TemplateStep campaign={c} onBack={() => go('recipients')} onNext={() => go('content')} />
        ) : null}
        {step === 'content' ? (
          <ContentStep
            key={c.templateId ?? 'empty'}
            campaign={c}
            onBack={() => go('template')}
            onNext={() => go('preview')}
          />
        ) : null}
        {step === 'preview' ? (
          <PreviewStep campaign={c} onBack={() => go('content')} onNext={() => go('review')} />
        ) : null}
        {step === 'review' ? <ReviewStep campaign={c} onBack={() => go('preview')} /> : null}
      </main>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t.discardConfirm.title}
        description={t.discardConfirm.text}
        confirmLabel={t.discardConfirm.confirm}
        pending={discard.isPending}
        onConfirm={() => discard.mutate({ id: campaignId })}
      />
    </div>
  );
}

function Footer({
  summary,
  onBack,
  next,
  onNext,
  disabled = false,
}: {
  summary?: ReactNode;
  onBack?: () => void;
  next: ReactNode;
  onNext: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border-subtle bg-white/95 px-5 py-3 shadow-raised backdrop-blur">
      <p className="mr-auto text-[13px] font-medium text-muted">{summary}</p>
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          {t.back}
        </Button>
      ) : null}
      <Button disabled={disabled} onClick={onNext}>
        {next}
      </Button>
    </div>
  );
}

function SkipBadge({ reason }: { reason: SkipReason | 'reserved' }) {
  return <Badge tone={reason === 'unsubscribed' ? 'warning' : 'danger'}>{t.skip[reason]}</Badge>;
}

// ---------------------------------------------------------------------------------------------
// 1. Recipients

const keyOf = (r: { customerId: string; contactId: string | null }) =>
  `${r.customerId}:${r.contactId ?? ''}`;

function RecipientsStep({ campaign, onNext }: { campaign: Campaign; onNext: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(campaign.id);
  const [customerIds, setCustomerIds] = useState(() => [
    ...new Set(campaign.messages.map((m) => m.customerId)),
  ]);
  const [chosen, setChosen] = useState(() => new Set(campaign.messages.map(keyOf)));
  const [typed, setTyped] = useState('');
  const candidates = useQuery({
    ...trpc.campaign.candidates.queryOptions({ customerIds }),
    placeholderData: keepPreviousData,
  });
  const found = useQuery({
    ...trpc.customer.list.queryOptions({ search: typed.trim(), pageSize: 8 }),
    enabled: typed.trim().length >= 2,
  });
  const save = useMutation(
    trpc.campaign.setRecipients.mutationOptions({
      onSuccess: async () => {
        await refresh();
        onNext();
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const customers = candidates.data ?? [];
  const toggle = (key: string) =>
    setChosen((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const applyMode = (mode: 'primary' | 'all') =>
    setChosen(
      new Set(
        customers.flatMap((customer) =>
          customer.self
            ? [keyOf({ customerId: customer.id, contactId: null })]
            : customer.contacts
                .filter((p) => mode === 'all' || p.isPrimary)
                .map((p) => keyOf({ customerId: customer.id, contactId: p.id })),
        ),
      ),
    );
  const queryClient = useQueryClient();
  const segments = useQuery(trpc.segment.list.queryOptions());
  const addSegment = async (id: string) => {
    if (!id) return;
    try {
      const found = await queryClient.fetchQuery({
        ...trpc.segment.customerIds.queryOptions({ id }),
        staleTime: 0,
      });
      const added = found.ids.filter((customerId) => !customerIds.includes(customerId));
      setCustomerIds((ids) => [...new Set([...ids, ...found.ids])].slice(0, 500));
      toast(
        found.capped ? 'warning' : 'success',
        found.capped ? sk.segments.capped : sk.segments.added(added.length),
      );
    } catch (error) {
      toast('error', errorMessage(error));
    }
  };
  const addCustomer = (id: string) => {
    if (customerIds.includes(id)) return;
    setCustomerIds((ids) => [...ids, id]);
    setTyped('');
  };
  useEffect(() => {
    // A customer just added gets its default recipient: the person, or the primary contact.
    setChosen((set) => {
      const next = new Set(set);
      for (const customer of customers) {
        const has = [...next].some((key) => key.startsWith(`${customer.id}:`));
        if (has) continue;
        if (customer.self) next.add(keyOf({ customerId: customer.id, contactId: null }));
        else {
          const primary = customer.contacts.find((p) => p.isPrimary) ?? customer.contacts[0];
          if (primary) next.add(keyOf({ customerId: customer.id, contactId: primary.id }));
        }
      }
      return next;
    });
  }, [candidates.data]);

  type Picked = { customerId: string; contactId: string | null; skip: SkipReason | null };
  const selected = customers.flatMap((customer): Picked[] =>
    customer.self
      ? chosen.has(keyOf({ customerId: customer.id, contactId: null }))
        ? [{ customerId: customer.id, contactId: null, skip: customer.self.skipReason }]
        : []
      : customer.contacts
          .filter((p) => chosen.has(keyOf({ customerId: customer.id, contactId: p.id })))
          .map((p) => ({ customerId: customer.id, contactId: p.id, skip: p.skipReason })),
  );
  const skipped = selected.filter((s) => s.skip).length;
  const r = t.recipients;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-[17px] font-semibold">{r.title}</h2>
          <p className="text-[13px] text-muted">{r.lead}</p>
        </div>
        <div role="group" aria-label={r.modes.label} className="flex gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => applyMode('primary')}>
            {r.modes.primary}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => applyMode('all')}>
            {r.modes.all}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        {(segments.data ?? []).length > 0 ? (
          <div className="w-64">
            <Select
              value=""
              aria-label={sk.segments.fromSegment}
              onChange={(id) => void addSegment(id)}
            >
              <SelectItem value="">{sk.segments.fromSegment}</SelectItem>
              {segments.data!.map((segment) => (
                <SelectItem key={segment.id} value={segment.id}>
                  {segment.name}
                </SelectItem>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="relative w-full max-w-md">
          <label className="flex h-10 items-center gap-2 rounded-[10px] border border-border bg-white px-3 focus-within:border-primary">
            <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
            <span className="sr-only">{r.searchCustomers}</span>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={r.addCustomers}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-tertiary"
            />
          </label>
          {typed.trim().length >= 2 && found.data ? (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border-subtle bg-white p-1 shadow-floating">
              {found.data.items.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => addCustomer(customer.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover"
                  >
                    <Plus className="size-4 text-primary-text" aria-hidden />
                    <span className="truncate">{customer.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted">{customer.city}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {customers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-white px-5 py-10 text-center text-sm text-muted">
          {r.empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {customers.map((customer) => (
            <li
              key={customer.id}
              className="rounded-2xl border border-border-subtle bg-white p-4 shadow-rest"
            >
              <div className="mb-2 flex items-center gap-2">
                <div className="mr-auto min-w-0">
                  <p className="truncate font-semibold">{customer.name}</p>
                  <p className="text-xs text-muted">
                    {[
                      customer.city,
                      customer.kind === 'individual'
                        ? r.individual
                        : customer.status
                          ? sk.customers.status[customer.status]
                          : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={r.removeCustomer(customer.name)}
                  onClick={() => {
                    setCustomerIds((ids) => ids.filter((id) => id !== customer.id));
                    setChosen(
                      (set) =>
                        new Set([...set].filter((key) => !key.startsWith(`${customer.id}:`))),
                    );
                  }}
                  className="rounded-md p-1 text-muted hover:bg-hover"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              {customer.self ? (
                <PersonRow
                  checked={chosen.has(keyOf({ customerId: customer.id, contactId: null }))}
                  onToggle={() => toggle(keyOf({ customerId: customer.id, contactId: null }))}
                  name={customer.name}
                  email={customer.self.email}
                  skip={customer.self.skipReason}
                />
              ) : customer.contacts.length === 0 ? (
                <p className="text-[13px] text-muted">
                  {r.noContact}. {r.noContactHint}
                </p>
              ) : (
                <ul className="space-y-1">
                  {customer.contacts.map((p) => (
                    <li key={p.id}>
                      <PersonRow
                        checked={chosen.has(keyOf({ customerId: customer.id, contactId: p.id }))}
                        onToggle={() => toggle(keyOf({ customerId: customer.id, contactId: p.id }))}
                        name={p.name}
                        email={p.email}
                        skip={p.skipReason}
                        primary={p.isPrimary}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <Footer
        summary={`${r.summary(selected.length - skipped)}${skipped ? ` · ${r.skippedSummary(skipped)}` : ''}`}
        next={t.next.recipients}
        disabled={save.isPending || selected.length === 0}
        onNext={() =>
          save.mutate({
            id: campaign.id,
            recipients: selected.map(({ customerId, contactId }) => ({ customerId, contactId })),
          })
        }
      />
    </div>
  );
}

function PersonRow({
  checked,
  onToggle,
  name,
  email,
  skip,
  primary = false,
}: {
  checked: boolean;
  onToggle: () => void;
  name: string;
  email: string | null;
  skip: SkipReason | null;
  primary?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
      <Checkbox checked={checked} onChange={onToggle} aria-label={t.recipients.select(name)} />
      <span className={cn('text-sm font-medium', skip && 'text-muted')}>{name}</span>
      {primary ? <Badge tone="info">{t.recipients.primary}</Badge> : null}
      {skip ? <SkipBadge reason={skip} /> : null}
      <span className="ml-auto truncate text-xs text-muted">{email ?? sk.common.none}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Template

function TemplateStep({
  campaign,
  onBack,
  onNext,
}: {
  campaign: Campaign;
  onBack: () => void;
  onNext: () => void;
}) {
  const toast = useToast();
  const refresh = useRefresh(campaign.id);
  const templates = useQuery(trpc.template.list.queryOptions({}));
  const choose = useMutation(
    trpc.campaign.chooseTemplate.mutationOptions({
      onSuccess: async () => {
        await refresh();
        onNext();
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const card = (id: string | null, title: string, text: string, category?: string | null) => (
    <button
      key={id ?? 'empty'}
      type="button"
      disabled={choose.isPending}
      onClick={() => choose.mutate({ id: campaign.id, templateId: id })}
      className={cn(
        'flex h-full flex-col gap-1 rounded-2xl border bg-white p-5 text-left shadow-rest transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-raised',
        campaign.templateId === id
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border-subtle',
      )}
    >
      {category ? <Badge className="w-fit">{category}</Badge> : null}
      <span className="text-[15px] font-semibold">{title}</span>
      <span className="line-clamp-2 text-[13px] text-muted">{text}</span>
      {campaign.templateId === id ? (
        <span className="mt-auto pt-2 text-xs font-semibold text-primary-text">
          {t.template.chosen}
        </span>
      ) : null}
    </button>
  );
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold">{t.template.title}</h2>
        <p className="text-[13px] text-muted">{t.template.lead}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {card(null, t.template.empty, t.template.emptyHint)}
        {(templates.data?.items ?? []).map((item) =>
          card(item.id, item.name, item.subject, item.categoryName),
        )}
      </div>
      <Footer onBack={onBack} next={t.next.template} onNext={onNext} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Content

function ContentStep({
  campaign,
  onBack,
  onNext,
}: {
  campaign: Campaign;
  onBack: () => void;
  onNext: () => void;
}) {
  const toast = useToast();
  const refresh = useRefresh(campaign.id);
  const me = useSession((s) => s.user);
  const look = useQuery(trpc.template.look.queryOptions());
  const [subject, setSubject] = useState<EmailNode>(campaign.subject);
  const [body, setBody] = useState<EmailNode>(campaign.body);
  const [common, setCommon] = useState<Record<string, string>>(campaign.commonValues);
  const [attachments, setAttachments] = useState(campaign.attachments.filter((a) => !a.trashed));
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      campaign.messages.map((m) => [m.id, { values: m.values, files: m.ownFiles }]),
    ),
  );
  const [picking, setPicking] = useState<'common' | Message | null>(null);
  const fields = campaign.customFields;
  const commonFields = fields.filter((f) => f.scope === 'common');
  const recipientFields = fields.filter((f) => f.scope === 'recipient');
  const saveContent = useMutation(trpc.campaign.saveContent.mutationOptions());
  const saveRecipient = useMutation(trpc.campaign.saveRecipient.mutationOptions());
  const sendable = campaign.messages.filter((m) => !m.skipReason);
  const missing = sendable.filter((m) =>
    fields.some((f) => !(f.scope === 'common' ? common[f.key] : rows[m.id]?.values[f.key])?.trim()),
  ).length;

  const next = async () => {
    try {
      await saveContent.mutateAsync({
        id: campaign.id,
        subject,
        body,
        customFields: fields,
        commonValues: common,
        attachmentFileIds: attachments.map((a) => a.id),
      });
      for (const m of campaign.messages) {
        const row = rows[m.id]!;
        await saveRecipient.mutateAsync({
          messageId: m.id,
          values: row.values,
          ownFileIds: row.files.map((f) => f.id),
        });
      }
      await refresh();
      onNext();
    } catch (error) {
      toast('error', errorMessage(error, { ...t.errors, ...sk.templates.errors }));
    }
  };
  const fillColumn = (field: CustomField) => {
    const first =
      Object.values(rows).find((r) => r.values[field.key]?.trim())?.values[field.key] ?? '';
    setRows((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, r]) => [
          id,
          { ...r, values: { ...r.values, [field.key]: first } },
        ]),
      ),
    );
  };

  if (!look.data) return <CardSkeleton lines={8} />;
  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-2xl border border-border-subtle bg-white p-5 shadow-rest">
        <h2 className="text-[17px] font-semibold">{t.content.common}</h2>
        <EmailSubjectEditor
          value={subject}
          onChange={setSubject}
          fields={fields}
          labelledBy="compose-subject"
        />
        {commonFields.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {commonFields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`common-${field.key}`}>{field.label}</Label>
                <Input
                  id={`common-${field.key}`}
                  value={common[field.key] ?? ''}
                  onChange={(e) => setCommon((v) => ({ ...v, [field.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        ) : null}
        <p className="text-[13px] text-muted">{t.content.bodyNote}</p>
        <div className="rounded-xl border border-border-subtle">
          <EmailBodyEditor
            value={body}
            onChange={setBody}
            fields={fields}
            look={look.data.look}
            senderName={me?.name ?? ''}
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t.content.attachments}</h3>
            <Button variant="ghost" size="sm" onClick={() => setPicking('common')}>
              <Paperclip className="size-3.5" aria-hidden />
              {t.content.attach}
            </Button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {attachments.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-xl border border-border-subtle px-2.5 py-1.5"
              >
                <FileBadge name={file.name} />
                <span className="text-[13px] font-semibold">{file.name}</span>
                <span className="text-xs text-muted">{formatSize(file.size)}</span>
                <button
                  type="button"
                  aria-label={sk.templates.attachments.remove(file.name)}
                  onClick={() => setAttachments((list) => list.filter((a) => a.id !== file.id))}
                  className="rounded-md p-0.5 text-muted hover:bg-hover"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border-subtle bg-white p-5 shadow-rest">
        <div>
          <h2 className="text-[17px] font-semibold">{t.content.perRecipient}</h2>
          <p className="text-[13px] text-muted">{t.content.perRecipientLead}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-[0.05em] text-tertiary uppercase">
                <th className="py-2 pr-3">{t.content.recipient}</th>
                <th className="py-2 pr-3">{t.content.salutation}</th>
                {recipientFields.map((field) => (
                  <th key={field.key} className="py-2 pr-3">
                    <span className="flex items-center gap-1.5">
                      {field.label}
                      <button
                        type="button"
                        title={t.content.fillColumn(field.label)}
                        aria-label={t.content.fillColumn(field.label)}
                        onClick={() => fillColumn(field)}
                        className="rounded p-0.5 text-primary-text hover:bg-primary-soft"
                      >
                        <ChevronRight className="size-3.5 rotate-90" aria-hidden />
                      </button>
                    </span>
                  </th>
                ))}
                <th className="py-2">{t.content.ownAttachment}</th>
              </tr>
            </thead>
            <tbody>
              {sendable.map((m) => {
                const row = rows[m.id]!;
                return (
                  <tr key={m.id} className="border-t border-border-subtle align-middle">
                    <td className="py-2 pr-3">
                      <p className="font-semibold">{m.name}</p>
                      <p className="text-xs text-muted">{m.customerName}</p>
                    </td>
                    <td className="py-2 pr-3 text-muted">{m.salutation ?? sk.common.none}</td>
                    {recipientFields.map((field) => (
                      <td key={field.key} className="py-2 pr-3">
                        <Input
                          aria-label={`${field.label}: ${m.name}`}
                          value={row.values[field.key] ?? ''}
                          aria-invalid={!row.values[field.key]?.trim() || undefined}
                          className={cn(
                            'h-9 min-w-24',
                            !row.values[field.key]?.trim() && 'border-danger',
                          )}
                          onChange={(e) =>
                            setRows((current) => ({
                              ...current,
                              [m.id]: {
                                ...row,
                                values: { ...row.values, [field.key]: e.target.value },
                              },
                            }))
                          }
                        />
                      </td>
                    ))}
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.files.map((file) => (
                          <span
                            key={file.id}
                            className="inline-flex items-center gap-1 rounded-lg bg-surface px-2 py-1 text-xs"
                          >
                            {file.name}
                            <button
                              type="button"
                              aria-label={sk.templates.attachments.remove(file.name)}
                              onClick={() =>
                                setRows((current) => ({
                                  ...current,
                                  [m.id]: {
                                    ...row,
                                    files: row.files.filter((f) => f.id !== file.id),
                                  },
                                }))
                              }
                            >
                              <X className="size-3" aria-hidden />
                            </button>
                          </span>
                        ))}
                        <Button variant="ghost" size="sm" onClick={() => setPicking(m)}>
                          <Plus className="size-3.5" aria-hidden />
                          {t.content.fromCustomerFolder}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {missing > 0 ? (
          <p className="flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            {t.content.missing(missing)}
          </p>
        ) : null}
      </section>
      <Footer
        onBack={onBack}
        next={t.next.content}
        onNext={() => void next()}
        disabled={saveContent.isPending}
      />
      {picking ? (
        <FilePicker
          customerId={picking === 'common' ? undefined : picking.customerId}
          lead={
            picking === 'common'
              ? t.content.attachments
              : `${picking.name} · ${picking.customerName}`
          }
          notes={[sk.templates.attachments.note]}
          already={
            new Set(
              picking === 'common'
                ? attachments.map((a) => a.id)
                : rows[picking.id]!.files.map((f) => f.id),
            )
          }
          onClose={() => setPicking(null)}
          onPick={(picked) => {
            const files = picked.map((p) => ({
              id: p.fileId,
              name: p.name,
              size: p.size,
              trashed: false,
            }));
            if (picking === 'common') setAttachments((list) => [...list, ...files]);
            else
              setRows((current) => ({
                ...current,
                [picking.id]: {
                  ...current[picking.id]!,
                  files: [...current[picking.id]!.files, ...files],
                },
              }));
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Preview

function PreviewStep({
  campaign,
  onBack,
  onNext,
}: {
  campaign: Campaign;
  onBack: () => void;
  onNext: () => void;
}) {
  const toast = useToast();
  const refresh = useRefresh(campaign.id);
  const queryClient = useQueryClient();
  const me = useSession((s) => s.user);
  const look = useQuery(trpc.template.look.queryOptions());
  const sendable = campaign.messages.filter((m) => !m.skipReason);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState<EmailNode | null>(null);
  const message = sendable[Math.min(index, sendable.length - 1)];
  const preview = useQuery({
    ...trpc.campaign.preview.queryOptions({ messageId: message?.id ?? '' }),
    enabled: message !== undefined,
    placeholderData: keepPreviousData,
  });
  const save = useMutation(
    trpc.campaign.saveRecipient.mutationOptions({
      onSuccess: async () => {
        setEditing(null);
        await refresh();
        await queryClient.invalidateQueries(trpc.campaign.preview.pathFilter());
      },
      onError: (error) =>
        toast('error', errorMessage(error, { ...t.errors, ...sk.templates.errors })),
    }),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => setValues(message?.values ?? {}), [message?.id]);
  const recipientFields = campaign.customFields.filter((f) => f.scope === 'recipient');
  const missingFor = (m: Message) => m.missing.length > 0;
  const edited = sendable.filter((m) => m.edited).length;
  const missingCount = sendable.filter(missingFor).length;
  const p = t.preview;
  const step = (delta: number) => {
    setEditing(null);
    setIndex((i) => Math.max(0, Math.min(sendable.length - 1, i + delta)));
  };
  if (!message) return <p className="text-sm text-muted">{t.errors.NO_RECIPIENTS}</p>;

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-border-subtle bg-white p-2 shadow-rest">
          <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-[0.06em] text-tertiary uppercase">
            {p.recipients(sendable.length)}
          </p>
          <ul>
            {sendable.map((m, i) => {
              const state = missingFor(m) ? 'missing' : m.edited ? 'edited' : 'ok';
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-current={i === index ? 'true' : undefined}
                    onClick={() => {
                      setEditing(null);
                      setIndex(i);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left',
                      i === index ? 'bg-primary-soft' : 'hover:bg-hover',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-6 shrink-0 items-center justify-center rounded-full',
                        state === 'missing'
                          ? 'bg-danger-soft text-danger'
                          : state === 'edited'
                            ? 'bg-warning-soft text-warning'
                            : 'bg-success-soft text-success',
                      )}
                    >
                      {state === 'missing' ? (
                        <AlertCircle className="size-3.5" />
                      ) : state === 'edited' ? (
                        <Pencil className="size-3" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{m.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {[
                          m.customerName,
                          state === 'edited' ? p.edited : state === 'missing' ? p.missing : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-rest">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3 text-[13px]">
            <div className="mr-auto min-w-0">
              <p className="truncate">{p.to(message.name, message.email ?? '')}</p>
              {preview.data ? (
                <p className="truncate text-muted">{p.from(preview.data.from)}</p>
              ) : null}
              {preview.data ? (
                <p className="truncate font-semibold">{preview.data.subject}</p>
              ) : null}
            </div>
            <Button
              size="icon"
              aria-label={p.previous}
              disabled={index === 0}
              onClick={() => step(-1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="text-muted">{p.position(index + 1, sendable.length)}</span>
            <Button
              size="icon"
              aria-label={p.next}
              disabled={index >= sendable.length - 1}
              onClick={() => step(1)}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
          {message.edited && !editing ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-warning-soft px-4 py-2 text-[13px] text-warning">
              <span className="mr-auto">{p.editedNote(message.name)}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  save.mutate({
                    messageId: message.id,
                    values: message.values,
                    ownFileIds: message.ownFiles.map((f) => f.id),
                    bodyOverride: null,
                  })
                }
              >
                {p.reset}
              </Button>
            </div>
          ) : null}
          {recipientFields.length > 0 && missingFor(message) ? (
            <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle px-4 py-3">
              {recipientFields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={`pv-${field.key}`} className="text-xs text-muted">
                    {field.label}
                  </Label>
                  <Input
                    id={`pv-${field.key}`}
                    className="h-9"
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  />
                </div>
              ))}
              <Button
                size="sm"
                onClick={() =>
                  save.mutate({
                    messageId: message.id,
                    values,
                    ownFileIds: message.ownFiles.map((f) => f.id),
                  })
                }
              >
                {sk.common.save}
              </Button>
            </div>
          ) : null}
          {editing && look.data ? (
            <>
              <EmailBodyEditor
                key={message.id}
                value={editing}
                onChange={setEditing}
                fields={campaign.customFields}
                look={look.data.look}
                senderName={me?.name ?? ''}
              />
              <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  {sk.common.cancel}
                </Button>
                <Button
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      messageId: message.id,
                      values: message.values,
                      ownFileIds: message.ownFiles.map((f) => f.id),
                      bodyOverride: editing,
                    })
                  }
                >
                  {p.editDone}
                </Button>
              </div>
            </>
          ) : (
            <div className="bg-[#e9eeee] p-4">
              <div className="mb-3 flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(message.bodyOverride ?? campaign.body)}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  {p.edit}
                </Button>
              </div>
              {preview.data ? (
                <iframe
                  title={sk.templates.preview.frame}
                  // No scripts: only the e-mail's HTML; the origin is kept so that it paints.
                  sandbox="allow-same-origin"
                  srcDoc={preview.data.html}
                  className="mx-auto block h-[820px] w-full max-w-[640px] rounded-lg border-0 bg-[#f4f6f6]"
                />
              ) : (
                <CardSkeleton lines={8} />
              )}
            </div>
          )}
        </section>
      </div>
      <Footer
        summary={p.summary(sendable.length - edited - missingCount, edited, missingCount)}
        onBack={onBack}
        next={t.next.preview}
        onNext={onNext}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 5. Review and send

function ReviewStep({ campaign, onBack }: { campaign: Campaign; onBack: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [testAt, setTestAt] = useState<string | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  // Tomorrow at 8:00 is the usual answer to „when“.
  const [day, setDay] = useState(() => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  });
  const [time, setTime] = useState('08:00');
  const scheduledAt = day && time ? new Date(`${day}T${time}`) : null;
  const first = campaign.messages.find((m) => !m.skipReason);
  const preview = useQuery({
    ...trpc.campaign.preview.queryOptions({ messageId: first?.id ?? '' }),
    enabled: first !== undefined,
  });
  const sendable = campaign.messages.filter((m) => !m.skipReason);
  const skipped = campaign.messages.filter((m) => m.skipReason);
  const edited = sendable.filter((m) => m.edited);
  const missing = sendable.filter((m) => m.missing.length > 0).length;
  const ownCount = sendable.filter((m) => m.ownFiles.length > 0).length;
  const test = useMutation(
    trpc.campaign.sendTest.mutationOptions({
      onSuccess: () =>
        setTestAt(new Date().toLocaleTimeString('sk-SK', { hour: 'numeric', minute: '2-digit' })),
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const send = useMutation(
    trpc.campaign.send.mutationOptions({
      onSuccess: async (result) => {
        toast(
          'success',
          result.scheduledAt
            ? t.review.scheduled(formatDateTime(result.scheduledAt))
            : t.review.sent(result.queued),
        );
        await queryClient.invalidateQueries(trpc.campaign.pathFilter());
        await navigate({ to: '/emails/sent/$campaignId', params: { campaignId: campaign.id } });
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const r = t.review;
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="grid gap-1 py-2.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
  const names = useMemo(() => sendable.map((m) => m.name).join(', '), [sendable]);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-2xl border border-border-subtle bg-white p-5 shadow-rest">
        <h2 className="mb-2 text-[17px] font-semibold">{r.summary}</h2>
        <dl className="divide-y divide-border-subtle">
          <Row label={r.subject}>{preview.data?.subject ?? sk.common.loading}</Row>
          <Row label={r.sender}>{preview.data?.from ?? sk.common.loading}</Row>
          <Row label={r.replies}>{r.repliesText(campaign.sender.email)}</Row>
          <Row label={r.recipients}>{r.recipientsText(sendable.length, names)}</Row>
          {skipped.length > 0 ? (
            <Row label={r.skipped}>
              {skipped.map((m) => `${m.name} (${t.skip[m.skipReason!]})`).join(', ')}
            </Row>
          ) : null}
          {edited.length > 0 ? (
            <Row
              label={r.edited}
            >{`${edited.length} · ${edited.map((m) => m.name).join(', ')}`}</Row>
          ) : null}
          <Row label={r.attachments}>
            {r.attachmentsText(campaign.attachments.length, ownCount)}
          </Row>
          <Row label={r.check}>
            {missing > 0 ? (
              <span className="text-danger">{r.missing(missing)}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="size-4" aria-hidden />
                {r.allFilled}
              </span>
            )}
          </Row>
        </dl>
      </section>
      <div className="space-y-4">
        <section className="rounded-2xl border border-border-subtle bg-white p-5 shadow-rest">
          <h2 className="text-[15px] font-semibold">{r.test}</h2>
          <p className="mt-1 text-[13px] text-muted">{r.testText}</p>
          <Button
            variant="secondary"
            className="mt-3 w-full"
            disabled={test.isPending || sendable.length === 0}
            onClick={() => test.mutate({ id: campaign.id })}
          >
            {r.testSend(campaign.sender.email)}
          </Button>
          {testAt ? (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] text-success">
              <Check className="size-4" aria-hidden />
              {r.testSent(testAt)}
            </p>
          ) : null}
        </section>
        <section className="rounded-2xl border border-border-subtle bg-white p-5 shadow-rest">
          <h2 className="text-[15px] font-semibold">{r.when}</h2>
          <div role="radiogroup" aria-label={r.when} className="mt-2 space-y-2">
            {(['now', 'later'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={when === choice}
                onClick={() => setWhen(choice)}
                className={cn(
                  'block w-full rounded-xl border px-3 py-2.5 text-left',
                  when === choice ? 'border-primary bg-[#f0f8f7]' : 'border-border hover:bg-hover',
                )}
              >
                <span className="block text-sm font-semibold">{r[choice]}</span>
                <span className="block text-[13px] text-muted">
                  {choice === 'now' ? r.nowHint : r.laterHint}
                </span>
              </button>
            ))}
          </div>
          {when === 'later' ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="schedule-date">{r.date}</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  className="mt-1.5"
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="schedule-time">{r.time}</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  step={300}
                  className="mt-1.5"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>
            </div>
          ) : null}
        </section>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onBack}>
            {t.back}
          </Button>
          <Button
            className="flex-1"
            disabled={
              send.isPending ||
              missing > 0 ||
              sendable.length === 0 ||
              (when === 'later' && !scheduledAt)
            }
            onClick={() =>
              send.mutate(
                when === 'later' && scheduledAt
                  ? { id: campaign.id, at: scheduledAt.toISOString() }
                  : { id: campaign.id },
              )
            }
          >
            <Send className="size-4" aria-hidden />
            {when === 'later' ? r.schedule(sendable.length) : r.send(sendable.length)}
          </Button>
        </div>
      </div>
    </div>
  );
}
