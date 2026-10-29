import { sk } from '@intra/shared/i18n';
import {
  CUSTOM_FIELD_SCOPES,
  CUSTOM_FIELD_TYPES,
  type CustomField,
  type EmailLook,
  type EmailNode,
  userFullName,
  variablesOf,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Monitor, Paperclip, Pencil, Plus, Smartphone, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { EmailBodyEditor, EmailSubjectEditor } from '@/components/emails/email-editor';
import { ErrorState } from '@/components/empty-state';
import { FileBadge } from '@/components/files/file-bits';
import { FilePicker } from '@/components/files/file-picker';
import { LeaveGuard } from '@/components/leave-guard';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatSize } from '@/lib/files';
import { formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan, useSession } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.templates;

export const Route = createFileRoute('/_app/emails_/templates/$templateId')({
  component: TemplateEditorPage,
});

type Template = RouterOutputs['template']['get'];

const paragraph = (content: EmailNode[] = []): EmailNode => ({ type: 'paragraph', content });
const EMPTY_SUBJECT: EmailNode = { type: 'doc', content: [paragraph()] };
const EMPTY_BODY: EmailNode = {
  type: 'doc',
  content: [
    paragraph([
      { type: 'variable', attrs: { name: 'salutation' } },
      { type: 'text', text: ',' },
    ]),
    paragraph(),
  ],
};

function TemplateEditorPage() {
  const { templateId } = Route.useParams();
  const isNew = templateId === 'new';
  const template = useQuery({
    ...trpc.template.get.queryOptions({ id: templateId }),
    enabled: !isNew,
  });
  const look = useQuery(trpc.template.look.queryOptions());

  if ((!isNew && template.isPending) || look.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader title={sk.common.loading} back={{ to: '/emails/templates', label: t.back }} />
        <div className="grid gap-5 p-7 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <CardSkeleton lines={6} />
          <CardSkeleton lines={10} />
        </div>
      </div>
    );
  }
  if ((!isNew && loadFailed(template)) || loadFailed(look)) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.title} back={{ to: '/emails/templates', label: t.back }} />
        <div className="p-10">
          <ErrorState
            text={errorMessage(template.error ?? look.error, t.errors)}
            onRetry={() => void template.refetch()}
          />
        </div>
      </div>
    );
  }
  // Keyed by the template: another one opened starts from its own state.
  return <Editor key={templateId} template={isNew ? null : template.data!} look={look.data.look} />;
}

/** A custom field's key from its label: „Počet sestier“ → `pocetSestier`. */
function keyFrom(label: string, taken: ReadonlySet<string>): string {
  const words = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const base =
    (words.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('') || 'pole')
      .replace(/^[0-9]+/, '')
      .slice(0, 32) || 'pole';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
  return key;
}

function Editor({ template, look }: { template: Template | null; look: EmailLook }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useSession((state) => state.user);
  const canWrite = useCan('template.write');
  const ids = useId();
  const [name, setName] = useState(template?.name ?? '');
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? '');
  const [subject, setSubject] = useState<EmailNode>(template?.subject ?? EMPTY_SUBJECT);
  const [body, setBody] = useState<EmailNode>(template?.body ?? EMPTY_BODY);
  const [fields, setFields] = useState<CustomField[]>(template?.customFields ?? []);
  const [attachments, setAttachments] = useState(
    template?.attachments.filter((a) => !a.trashed) ?? [],
  );
  const [active, setActive] = useState(template?.active ?? true);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [fieldDialog, setFieldDialog] = useState<CustomField | 'new' | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = useQuery(trpc.codeList.list.queryOptions({ list: 'template_category' }));
  const touch =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setDirty(true);
    };

  const input = {
    name: name.trim(),
    categoryId: categoryId || null,
    language: 'sk' as const,
    subject,
    body,
    customFields: fields,
    attachmentFileIds: attachments.map((a) => a.fileId),
    active,
  };
  const onFail = (failure: unknown) =>
    setError(errorMessage(failure, { ...t.errors, ...sk.validation }));
  const refresh = () => queryClient.invalidateQueries(trpc.template.pathFilter());
  const create = useMutation(
    trpc.template.create.mutationOptions({
      onSuccess: async (created) => {
        toast('success', t.created);
        await refresh();
        await navigate({
          to: '/emails/templates/$templateId',
          params: { templateId: created.id },
          replace: true,
        });
      },
      onError: onFail,
    }),
  );
  const update = useMutation(
    trpc.template.update.mutationOptions({
      onSuccess: async () => {
        toast('success', t.saved);
        setDirty(false);
        await refresh();
      },
      onError: onFail,
    }),
  );
  const duplicate = useMutation(
    trpc.template.duplicate.mutationOptions({
      onSuccess: async (created) => {
        toast('success', t.duplicated);
        await refresh();
        await navigate({ to: '/emails/templates/$templateId', params: { templateId: created.id } });
      },
      onError: (failure) => toast('error', errorMessage(failure, t.errors)),
    }),
  );
  const pending = create.isPending || update.isPending;
  const save = () => {
    if (!input.name) {
      setError(`${t.fields.name}: ${sk.validation.required}`);
      return;
    }
    setError(null);
    if (template) update.mutate({ id: template.id, template: input });
    else create.mutate(input);
  };

  const used = new Set([...variablesOf(subject), ...variablesOf(body)]);
  const removeField = (field: CustomField) => {
    if (used.has(`custom.${field.key}`)) {
      toast('warning', t.customFields.inUse);
      return;
    }
    setFields((list) => list.filter((f) => f.key !== field.key));
    setDirty(true);
  };

  const status = template
    ? dirty
      ? t.unsaved
      : t.savedAt(formatDateTime(template.updatedAt), template.updatedBy ?? sk.common.none)
    : t.unsaved;

  return (
    <div className="min-w-0">
      <LeaveGuard dirty={dirty} saving={pending} />
      <PageHeader
        title={name.trim() || t.untitled}
        subtitle={status}
        back={{ to: '/emails/templates', label: t.back }}
      >
        {template && canWrite ? (
          <Button
            variant="ghost"
            disabled={duplicate.isPending}
            onClick={() => duplicate.mutate({ id: template.id })}
          >
            {t.duplicate}
          </Button>
        ) : null}
        {canWrite ? (
          <Button disabled={pending || (!dirty && template !== null)} onClick={save}>
            {t.save}
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex max-w-[1440px] flex-wrap items-start gap-5 px-7 pt-5 pb-10">
        <aside className="flex w-full max-w-[340px] flex-[1_1_300px] flex-col gap-5 rounded-2xl border border-border-subtle bg-white p-5 shadow-rest">
          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <div className="space-y-2.5">
            <div className="space-y-2">
              <Label htmlFor={`${ids}-name`}>{t.fields.name}</Label>
              <Input
                id={`${ids}-name`}
                maxLength={120}
                value={name}
                onChange={(event) => touch(setName)(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-2">
                <Label htmlFor={`${ids}-category`}>{t.fields.category}</Label>
                <Select id={`${ids}-category`} value={categoryId} onChange={touch(setCategoryId)}>
                  <SelectItem value="">{t.noCategory}</SelectItem>
                  {(categories.data?.items ?? [])
                    .filter((c) => c.active || c.id === categoryId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${ids}-language`}>{t.fields.language}</Label>
                <Select id={`${ids}-language`} value="sk" onChange={() => undefined}>
                  <SelectItem value="sk">{t.fields.languages.sk}</SelectItem>
                </Select>
              </div>
            </div>
            <EmailSubjectEditor
              value={subject}
              onChange={touch(setSubject)}
              fields={fields}
              labelledBy={`${ids}-subject`}
            />
          </div>

          <section>
            <h2 className="text-sm font-semibold">{t.customFields.title}</h2>
            <p className="mt-0.5 mb-2.5 text-[13px] leading-[18px] text-muted">
              {t.customFields.lead}
            </p>
            <ul className="space-y-1.5">
              {fields.map((field) => (
                <li
                  key={field.key}
                  className="flex items-center gap-2 rounded-[10px] border border-border-subtle px-2.5 py-2"
                >
                  <span className="inline-flex h-[22px] items-center rounded-md bg-primary-soft px-2 text-[13px] font-semibold text-primary-text">
                    {field.label}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    {t.customFields.meta(
                      t.customFields.types[field.type],
                      t.customFields.scopes[field.scope],
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={t.customFields.edit(field.label)}
                    onClick={() => setFieldDialog(field)}
                    className="rounded-md p-1 text-muted hover:bg-hover"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t.customFields.remove(field.label)}
                    onClick={() => removeField(field)}
                    className="rounded-md p-1 text-muted hover:bg-hover"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1.5 px-1"
              onClick={() => setFieldDialog('new')}
            >
              <Plus className="size-3.5" aria-hidden />
              {t.customFields.add}
            </Button>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">{t.attachments.title}</h2>
            <ul className="space-y-1.5">
              {attachments.map((file) => (
                <li
                  key={file.fileId}
                  className="flex items-center gap-2.5 rounded-[10px] border border-border-subtle px-2.5 py-2"
                >
                  <FileBadge name={file.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{file.name}</span>
                    <span className="block text-xs text-muted">{formatSize(file.size)}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={t.attachments.remove(file.name)}
                    onClick={() => {
                      setAttachments((list) => list.filter((a) => a.fileId !== file.fileId));
                      setDirty(true);
                    }}
                    className="rounded-md p-1 text-muted hover:bg-hover"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1.5 px-1"
              onClick={() => setPicking(true)}
            >
              <Paperclip className="size-3.5" aria-hidden />
              {t.attachments.add}
            </Button>
          </section>

          <div className="flex items-center gap-3 border-t border-border-subtle pt-4">
            <span className="flex-1">
              <span className="block text-sm font-semibold">{t.active.label}</span>
              <span className="block text-[13px] text-muted">{t.active.hint}</span>
            </span>
            <Switch
              checked={active}
              label={t.active.label}
              onChange={() => touch(setActive)(!active)}
            />
          </div>
        </aside>

        <section className="min-w-0 flex-[999_1_640px] overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-rest">
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border-subtle px-4 py-3">
            <div
              role="tablist"
              aria-label={t.modes.label}
              className="flex rounded-[10px] bg-surface p-1"
            >
              {(['edit', 'preview'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  onClick={() => setMode(key)}
                  className={cn(
                    'h-8 rounded-lg px-3 text-[13px] font-semibold transition-colors',
                    mode === key ? 'bg-white text-primary-text shadow-rest' : 'text-muted',
                  )}
                >
                  {t.modes[key]}
                </button>
              ))}
            </div>
          </div>
          {mode === 'edit' ? (
            <EmailBodyEditor
              value={body}
              onChange={touch(setBody)}
              fields={fields}
              look={look}
              senderName={me ? userFullName(me) : sk.templates.variables['sender.name']}
            />
          ) : (
            <Preview subject={subject} body={body} fields={fields} />
          )}
        </section>
      </div>

      {fieldDialog ? (
        <FieldDialog
          field={fieldDialog === 'new' ? null : fieldDialog}
          onClose={() => setFieldDialog(null)}
          onSave={(saved) => {
            setFields((list) => {
              if (fieldDialog === 'new') {
                const key = keyFrom(saved.label, new Set(list.map((f) => f.key)));
                return [...list, { ...saved, key }];
              }
              return list.map((f) => (f.key === fieldDialog.key ? { ...saved, key: f.key } : f));
            });
            setDirty(true);
            setFieldDialog(null);
          }}
        />
      ) : null}
      {picking ? (
        <FilePicker
          lead={t.attachments.title}
          notes={[t.attachments.note]}
          already={new Set(attachments.map((a) => a.fileId))}
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setAttachments((list) => [
              ...list,
              ...picked.map((p) => ({
                fileId: p.fileId,
                name: p.name,
                size: p.size,
                trashed: false,
              })),
            ]);
            setDirty(true);
          }}
        />
      ) : null}
    </div>
  );
}

function FieldDialog({
  field,
  onClose,
  onSave,
}: {
  field: CustomField | null;
  onClose: () => void;
  onSave: (field: Omit<CustomField, 'key'>) => void;
}) {
  const f = t.customFields;
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<CustomField['type']>(field?.type ?? 'text');
  const [scope, setScope] = useState<CustomField['scope']>(field?.scope ?? 'recipient');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{f.dialogTitle}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (label.trim()) onSave({ label: label.trim(), type, scope });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="field-label">{f.label}</Label>
            <Input
              id="field-label"
              autoFocus
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="field-type">{f.type}</Label>
              <Select
                id="field-type"
                value={type}
                onChange={(value) => setType(value as CustomField['type'])}
              >
                {CUSTOM_FIELD_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {f.types[value]}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="field-scope">{f.scope}</Label>
              <Select
                id="field-scope"
                value={scope}
                onChange={(value) => setScope(value as CustomField['scope'])}
              >
                {CUSTOM_FIELD_SCOPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {f.scopes[value]}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={!label.trim()}>
              {sk.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * „Náhľad pre kontakt“: the exact HTML the provider would get for one contact, with the values of
 * the custom fields typed here. Missing values are marked in red and counted.
 */
function Preview({
  subject,
  body,
  fields,
}: {
  subject: EmailNode;
  body: EmailNode;
  fields: CustomField[];
}) {
  const p = t.preview;
  const contacts = useQuery(trpc.template.previewContacts.queryOptions());
  const [contactId, setContactId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const chosen = contactId || contacts.data?.[0]?.id || '';
  const typed = useDebounced(values, 400);
  const preview = useQuery({
    ...trpc.template.preview.queryOptions({
      subject,
      body,
      customFields: fields,
      ...(chosen ? { contactId: chosen } : {}),
      values: typed,
    }),
    placeholderData: keepPreviousData,
  });
  const me = useSession((state) => state.user);
  const canSend = useCan('email.send');
  const toast = useToast();
  const [testAt, setTestAt] = useState<string | null>(null);
  const test = useMutation(
    trpc.template.sendTest.mutationOptions({
      onSuccess: () =>
        setTestAt(new Date().toLocaleTimeString('sk-SK', { hour: 'numeric', minute: '2-digit' })),
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  return (
    <div className="grid gap-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-4 border-b border-border-subtle p-4 lg:border-r lg:border-b-0">
        <div className="space-y-2">
          <Label htmlFor="preview-contact">{p.contact}</Label>
          <Select id="preview-contact" value={chosen} onChange={setContactId}>
            {(contacts.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {`${c.name} · ${c.customerName}`}
              </SelectItem>
            ))}
          </Select>
        </div>
        {fields.length > 0 ? (
          <div className="space-y-2.5">
            <p className="text-sm font-medium">{p.values}</p>
            {fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`value-${field.key}`} className="text-xs text-muted">
                  {field.label}
                </Label>
                <Input
                  id={`value-${field.key}`}
                  value={values[field.key] ?? ''}
                  onChange={(event) =>
                    setValues((v) => ({ ...v, [field.key]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
        {preview.data ? (
          <p
            role="status"
            className={cn(
              'rounded-xl px-3 py-2 text-[13px]',
              preview.data.missing.length > 0
                ? 'bg-danger-soft text-danger'
                : 'bg-success-soft text-success',
            )}
          >
            {preview.data.missing.length > 0 ? p.missing(preview.data.missing.length) : p.complete}
          </p>
        ) : null}
        {canSend && me ? (
          <div className="space-y-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={test.isPending}
              onClick={() =>
                test.mutate({
                  subject,
                  body,
                  customFields: fields,
                  ...(chosen ? { contactId: chosen } : {}),
                  values,
                })
              }
            >
              {p.test(me.email)}
            </Button>
            {testAt ? (
              <p role="status" className="text-[13px] text-muted">
                {p.testSent(testAt)}
              </p>
            ) : null}
          </div>
        ) : null}
        <div role="radiogroup" aria-label={t.devices.label} className="flex gap-1.5">
          {(['desktop', 'phone'] as const).map((key) => {
            const Icon = key === 'desktop' ? Monitor : Smartphone;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={device === key}
                onClick={() => setDevice(key)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium',
                  device === key
                    ? 'border-primary bg-primary-soft text-primary-text'
                    : 'border-border text-muted',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {t.devices[key]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="bg-[#e9eeee] p-4">
        {preview.data ? (
          <>
            <p className="mb-3 rounded-lg bg-white px-3 py-2 text-sm">
              <span className="text-muted">{p.subject}: </span>
              <span className="font-semibold">{preview.data.subject}</span>
            </p>
            <iframe
              title={p.frame}
              // No scripts, no forms, no navigation: only the e-mail's HTML and its images. The
              // frame keeps the page's origin only so that its images load and it paints.
              sandbox="allow-same-origin"
              srcDoc={preview.data.html}
              className={cn(
                'mx-auto block h-[900px] rounded-lg border-0 bg-[#f4f6f6] transition-[width] duration-150',
                device === 'desktop' ? 'w-full max-w-[640px]' : 'w-[375px]',
              )}
            />
          </>
        ) : (
          <CardSkeleton lines={8} />
        )}
      </div>
    </div>
  );
}
