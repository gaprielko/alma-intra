import { sk } from '@intra/shared/i18n';
import {
  type DirectRecipient,
  type EmailNode,
  personName,
  userFullName,
} from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Paperclip, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '@/components/customers/organization-list';
import { PersonDialog } from '@/components/customers/person-dialog';
import { EmailBodyEditor } from '@/components/emails/email-editor';
import { ErrorState } from '@/components/empty-state';
import { FilePicker } from '@/components/files/file-picker';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatSize } from '@/lib/files';
import { loadFailed } from '@/lib/query-view';
import { useSession } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/emails_/new/$campaignId')({ component: NewEmailPage });

const t = sk.directEmail;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

type Role = DirectRecipient['role'];
type Draft = RouterOutputs['campaign']['getDirect'];

function NewEmailPage() {
  const { campaignId } = Route.useParams();
  const draft = useQuery({
    ...trpc.campaign.getDirect.queryOptions({ id: campaignId }),
    // The form takes over from here: a refetch must not overwrite what is being typed.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const look = useQuery(trpc.template.look.queryOptions());
  if (draft.isPending || look.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.title} back={{ to: '/emails/inbox', label: sk.inbound.back }} />
        <div className="p-7">
          <CardSkeleton lines={8} />
        </div>
      </div>
    );
  }
  if (loadFailed(draft) || loadFailed(look)) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.title} back={{ to: '/emails/inbox', label: sk.inbound.back }} />
        <ErrorState
          text={errorMessage(draft.error, sk.campaigns.errors)}
          onRetry={() => void draft.refetch()}
        />
      </div>
    );
  }
  return <Composer key={campaignId} draft={draft.data} look={look.data.look} />;
}

function Composer({
  draft,
  look,
}: {
  draft: Draft;
  look: RouterOutputs['template']['look']['look'];
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useSession((s) => s.user);
  const [recipients, setRecipients] = useState<DirectRecipient[]>(draft.recipients);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState<EmailNode>(draft.body);
  const [bodyKey, setBodyKey] = useState(0);
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId);
  const [attachments, setAttachments] = useState(draft.attachments);
  const [copies, setCopies] = useState(draft.recipients.some((r) => r.role !== 'to'));
  const [picking, setPicking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState<DirectRecipient | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const templates = useQuery(trpc.template.list.queryOptions({}));
  const onError = (error: unknown) => toast('error', errorMessage(error, sk.campaigns.errors));

  const save = useMutation(trpc.campaign.saveDirect.mutationOptions({ onError }));
  const content = {
    id: draft.id,
    recipients,
    subject,
    body,
    templateId,
    attachmentFileIds: attachments.map((a) => a.id),
  };
  // Saved as it is written, so it is in „Koncepty“ whatever happens to this page.
  const latest = useRef(content);
  latest.current = content;
  const typed = useDebounced(JSON.stringify(content), 800);
  const saved = useRef(JSON.stringify(content));
  const { mutate: store } = save;
  useEffect(() => {
    if (typed === saved.current) return;
    saved.current = typed;
    store(JSON.parse(typed) as typeof content);
  }, [typed, store]);

  const send = useMutation(trpc.campaign.sendDirect.mutationOptions({ onError }));
  const sendNow = async () => {
    try {
      await save.mutateAsync(latest.current);
      saved.current = JSON.stringify(latest.current);
      await send.mutateAsync({ id: draft.id });
      toast('success', t.sent);
      await queryClient.invalidateQueries(trpc.campaign.list.pathFilter());
      await navigate({ to: '/emails/sent/$campaignId', params: { campaignId: draft.id } });
    } catch {
      // Told by the mutation's own `onError`.
    }
  };
  const remove = useMutation(
    trpc.campaign.deleteDraft.mutationOptions({
      onSuccess: async () => {
        toast('success', sk.campaigns.discardConfirm.done);
        await queryClient.invalidateQueries(trpc.campaign.list.pathFilter());
        await navigate({ to: '/emails/inbox' });
      },
      onError,
    }),
  );

  const firstTo = recipients.find((r) => r.role === 'to');
  const fromTemplate = useMutation(
    trpc.campaign.directFromTemplate.mutationOptions({
      onSuccess: (filled) => {
        setSubject(filled.subject);
        setBody(filled.body);
        setBodyKey((key) => key + 1);
      },
      onError,
    }),
  );
  const pickTemplate = (id: string) => {
    if (!id) {
      setTemplateId(null);
      return;
    }
    setTemplateId(id);
    fromTemplate.mutate({
      templateId: id,
      contactId: firstTo?.contactId ?? null,
      organizationId: firstTo?.organizationId ?? null,
    });
  };

  const add = (role: Role, added: Omit<DirectRecipient, 'role'>[]) =>
    setRecipients((now) => [
      ...now,
      ...added.filter((a) => !now.some((r) => r.email === a.email)).map((a) => ({ ...a, role })),
    ]);
  const unknown = recipients.filter((r) => !r.contactId && !dismissed.has(r.email));
  const ready =
    recipients.some((r) => r.role === 'to') &&
    subject.trim() !== '' &&
    JSON.stringify(body).includes('"text"');

  return (
    <div className="min-w-0">
      <PageHeader
        title={t.title}
        subtitle={me ? t.from(userFullName(me), look.brandName) : undefined}
        back={{ to: '/emails/inbox', label: sk.inbound.back }}
      >
        <Button variant="ghost" onClick={() => setDiscarding(true)}>
          {sk.campaigns.discard}
        </Button>
        <Button
          disabled={!ready || send.isPending || save.isPending}
          onClick={() => void sendNow()}
        >
          <Send className="size-4" aria-hidden />
          {t.send}
        </Button>
      </PageHeader>
      <main className="px-7 pt-5 pb-10">
        <Card className="mx-auto max-w-[56rem] overflow-visible">
          <RecipientRow
            label={t.to}
            role="to"
            recipients={recipients}
            onAdd={add}
            onRemove={(email) => setRecipients((now) => now.filter((r) => r.email !== email))}
            aside={
              copies ? null : (
                <button
                  type="button"
                  onClick={() => setCopies(true)}
                  className="shrink-0 text-[13px] font-semibold text-primary-text"
                >
                  {t.showCopies}
                </button>
              )
            }
          />
          {copies ? (
            <>
              <RecipientRow
                label={t.cc}
                role="cc"
                recipients={recipients}
                onAdd={add}
                onRemove={(email) => setRecipients((now) => now.filter((r) => r.email !== email))}
              />
              <RecipientRow
                label={t.bcc}
                role="bcc"
                recipients={recipients}
                onAdd={add}
                onRemove={(email) => setRecipients((now) => now.filter((r) => r.email !== email))}
              />
            </>
          ) : null}
          {unknown.map((r) => (
            <p
              key={r.email}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle bg-warning-soft/50 px-5 py-2.5 text-[13px]"
            >
              <span className="min-w-0 flex-[1_1_16rem]">{t.unknown(r.email)}</span>
              <Button size="sm" variant="secondary" onClick={() => setSaving(r)}>
                {t.saveContact}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed((now) => new Set(now).add(r.email))}
              >
                {t.notNow}
              </Button>
            </p>
          ))}
          <label className="flex items-center gap-3 border-b border-border-subtle px-5 py-2">
            <span className="w-24 shrink-0 text-[13px] font-medium text-muted">{t.subject}</span>
            <Input
              aria-label={t.subject}
              value={subject}
              maxLength={998}
              onChange={(event) => setSubject(event.target.value)}
              className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
            />
          </label>
          <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-2">
            <span className="w-24 shrink-0 text-[13px] font-medium text-muted">{t.template}</span>
            <div className="w-full max-w-sm">
              <Select
                id="direct-template"
                value={templateId ?? ''}
                onChange={pickTemplate}
                aria-label={t.template}
              >
                <SelectItem value="">{t.noTemplate}</SelectItem>
                {(templates.data?.items ?? [])
                  .filter((template) => template.active)
                  .map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
              </Select>
            </div>
          </div>
          <div className="p-5">
            <EmailBodyEditor
              key={bodyKey}
              value={body}
              onChange={setBody}
              fields={[]}
              look={look}
              senderName={me ? userFullName(me) : ''}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-5 py-3">
            {attachments.map((file) => (
              <span
                key={file.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-2 py-1 text-[13px]"
              >
                <Paperclip className="size-3.5 text-muted" aria-hidden />
                {file.name}
                <span className="text-xs text-muted">{formatSize(file.size)}</span>
                <button
                  type="button"
                  aria-label={t.removeAttachment(file.name)}
                  onClick={() =>
                    setAttachments((now) => now.filter((other) => other.id !== file.id))
                  }
                >
                  <X className="size-3.5 text-muted" aria-hidden />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
              <Paperclip className="size-3.5" aria-hidden />
              {t.attach}
            </Button>
          </div>
        </Card>
      </main>
      {picking ? (
        <FilePicker
          customerId={firstTo?.organizationId ?? undefined}
          lead={t.title}
          notes={[sk.templates.attachments.note]}
          already={new Set(attachments.map((a) => a.id))}
          onClose={() => setPicking(false)}
          onPick={(picked) =>
            setAttachments((now) => [
              ...now,
              ...picked.map((p) => ({ id: p.fileId, name: p.name, size: p.size })),
            ])
          }
        />
      ) : null}
      {saving ? (
        <PersonDialog
          initialEmail={saving.email}
          onCreated={(created) =>
            setRecipients((now) =>
              now.map((r) =>
                r.email === saving.email
                  ? { ...r, contactId: created.id, organizationId: created.customerId }
                  : r,
              ),
            )
          }
          onClose={() => setSaving(null)}
        />
      ) : null}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={sk.campaigns.discardConfirm.title}
        description={t.discardText}
        confirmLabel={sk.campaigns.discard}
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: draft.id })}
      />
    </div>
  );
}

/**
 * „Komu“, „Kópia“ or „Skrytá kópia“: the recipients as chips, and one field that finds contacts,
 * organizations and partners (an organization brings its main contact) or takes any address.
 */
function RecipientRow({
  label,
  role,
  recipients,
  onAdd,
  onRemove,
  aside,
}: {
  label: string;
  role: Role;
  recipients: DirectRecipient[];
  onAdd: (role: Role, added: Omit<DirectRecipient, 'role'>[]) => void;
  onRemove: (email: string) => void;
  aside?: React.ReactNode;
}) {
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDebounced(typed.trim(), 250);
  const enabled = open && term.length >= 2;
  const customers = useQuery({
    ...trpc.customer.list.queryOptions({ search: term, pageSize: 6 }),
    enabled,
  });
  const persons = useQuery({
    ...trpc.person.list.queryOptions({ search: term, pageSize: 6 }),
    enabled,
  });
  const people = (persons.data?.items ?? []).filter((p) => p.email);
  const organizations = customers.data?.items ?? [];
  const address = typed.trim().toLowerCase();
  const isAddress = EMAIL.test(address);
  const take = (added: Omit<DirectRecipient, 'role'>) => {
    onAdd(role, [added]);
    setTyped('');
    setOpen(false);
  };
  const takeTyped = () => {
    const known = people.find((p) => p.email?.toLowerCase() === address);
    take(
      known
        ? {
            email: address,
            name: personName(known),
            contactId: known.id,
            organizationId: known.organizations[0]?.id ?? null,
          }
        : { email: address, name: null, contactId: null, organizationId: null },
    );
  };
  const mine = recipients.filter((r) => r.role === role);
  return (
    <div className="relative flex items-start gap-3 border-b border-border-subtle px-5 py-2">
      <span className="w-24 shrink-0 pt-1.5 text-[13px] font-medium text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {mine.map((r) => (
          <span
            key={r.email}
            title={r.email}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full pr-1.5 pl-2.5 text-[13px] font-semibold',
              r.contactId ? 'bg-primary-soft text-primary-text' : 'bg-warning-soft text-warning',
            )}
          >
            {r.name ?? r.email}
            <button
              type="button"
              aria-label={t.removeRecipient(r.name ?? r.email)}
              onClick={() => onRemove(r.email)}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          value={typed}
          placeholder={mine.length === 0 ? t.searchPlaceholder : undefined}
          onChange={(event) => {
            setTyped(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ',' || event.key === ';') && isAddress) {
              event.preventDefault();
              takeTyped();
            } else if (event.key === 'Enter') {
              event.preventDefault();
            } else if (event.key === 'Backspace' && !typed && mine.length > 0) {
              onRemove(mine[mine.length - 1]!.email);
            }
          }}
          className="h-8 min-w-48 flex-1 bg-transparent text-sm outline-none placeholder:text-tertiary"
        />
      </div>
      {aside ? <div className="pt-1.5">{aside}</div> : null}
      {enabled ? (
        <div className="absolute top-full left-[8.75rem] z-20 max-h-96 w-[30rem] max-w-[calc(100vw-4rem)] overflow-y-auto rounded-xl border border-border-subtle bg-white p-1.5 shadow-lg">
          {people.length > 0 ? <p className={GROUP}>{t.contacts}</p> : null}
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                take({
                  email: p.email!.toLowerCase(),
                  name: personName(p),
                  contactId: p.id,
                  organizationId: p.organizations[0]?.id ?? null,
                })
              }
              className={OPTION}
            >
              <span className="block truncate font-semibold">{personName(p)}</span>
              <span className="block truncate text-xs text-muted">
                {[p.email, p.organizations[0]?.name].filter(Boolean).join(' · ')}
              </span>
              {p.unsubscribedAt ? (
                <span className="block text-xs text-warning">{t.unsubscribed}</span>
              ) : null}
            </button>
          ))}
          {organizations.length > 0 ? <p className={GROUP}>{t.organizations}</p> : null}
          {organizations.map((o) => {
            const main = o.primaryContact?.email ? o.primaryContact : null;
            return (
              <button
                key={o.id}
                type="button"
                disabled={!main}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  main &&
                  take({
                    email: main.email!.toLowerCase(),
                    name: main.name,
                    contactId: main.id,
                    organizationId: o.id,
                  })
                }
                className={cn(OPTION, !main && 'cursor-default opacity-50 hover:bg-transparent')}
              >
                <span className="block truncate font-semibold">{o.name}</span>
                <span className="block truncate text-xs text-muted">
                  {main ? t.mainContact(main.name) : t.noMainContact}
                </span>
              </button>
            );
          })}
          {isAddress && !people.some((p) => p.email?.toLowerCase() === address) ? (
            <>
              <p className={GROUP}>{t.newAddress}</p>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={takeTyped}
                className={OPTION}
              >
                <span className="block truncate font-semibold">{address}</span>
                <span className="block text-xs text-muted">{t.notInContacts}</span>
              </button>
            </>
          ) : null}
          {customers.isSuccess &&
          persons.isSuccess &&
          people.length === 0 &&
          organizations.length === 0 &&
          !isAddress ? (
            <p className="px-3 py-2.5 text-sm text-muted">{t.nothing}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const GROUP = 'px-3 pt-2 pb-1 text-xs font-semibold text-muted';
const OPTION = 'block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-primary-soft/60';
