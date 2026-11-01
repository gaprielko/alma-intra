import { sk } from '@intra/shared/i18n';
import {
  ACCENT_COLORS,
  type EmailNode,
  type EmailSettings,
  HEADER_STYLES,
  LOOK_KINDS,
  type LookFields,
  lookFieldsSchema,
  type LookKind,
  REPLY_MODES,
  senderNameOf,
} from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  EmailHeaderEditor,
  EmailLookDocEditor,
  EmailSubjectEditor,
  FOOTER_VARIABLES,
  SIGNATURE_VARIABLES,
} from '@/components/emails/email-editor';
import { ErrorState } from '@/components/empty-state';
import { FilePicker } from '@/components/files/file-picker';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedChoice } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { ImageNotAllowed, uploadEmailImage } from '@/lib/email-images';
import { errorMessage } from '@/lib/errors';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { trpc, trpcClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.emailLook;

export const Route = createFileRoute('/_app/settings/email-look')({
  component: EmailLookPage,
});

/** What the left column picks: a look of the chosen type, or what all looks have in common. */
type Picked = 'global' | 'common' | (string & {});

const kindOptions = LOOK_KINDS.map((key) => ({ key, label: t.kinds[key] }));

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}

function EmailLookPage() {
  const [kind, setKind] = useState<LookKind>('personal');
  const [picked, setPicked] = useState<Picked>('global');
  const look = useQuery(trpc.template.look.queryOptions());
  const company = useQuery(trpc.template.company.queryOptions());
  const settings = useQuery(trpc.template.emailSettings.queryOptions());
  const global = useQuery(trpc.template.globalLook.queryOptions({ kind }));
  const products = useQuery(trpc.template.productLooks.queryOptions({ kind }));
  if (look.isPending || company.isPending || settings.isPending || global.isPending) {
    return (
      <div className="grid gap-5 px-7 pt-5 pb-10 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <CardSkeleton lines={8} />
        <CardSkeleton lines={10} />
      </div>
    );
  }
  if (loadFailed(look) || loadFailed(company) || loadFailed(settings) || loadFailed(global)) {
    return <ErrorState onRetry={() => void look.refetch()} />;
  }
  const product = products.data?.find((p) => p.productId === picked) ?? null;
  const row = (id: Picked, name: string, state: string, on: boolean) => (
    <button
      key={id}
      type="button"
      aria-current={picked === id ? 'true' : undefined}
      onClick={() => setPicked(id)}
      className={cn(
        'block w-full rounded-xl px-3 py-2 text-left hover:bg-hover',
        picked === id && 'bg-primary-soft hover:bg-primary-soft',
      )}
    >
      <span className="block text-sm font-semibold">{name}</span>
      <span className={cn('block text-xs', on ? 'text-primary-text' : 'text-muted')}>{state}</span>
    </button>
  );
  return (
    <div className="grid items-start gap-5 px-7 pt-5 pb-10 xl:grid-cols-[15rem_minmax(0,26rem)_minmax(0,1fr)]">
      <div className="space-y-3">
        <Caption>{t.columns.pick}</Caption>
        <nav
          aria-label={t.looks}
          className="space-y-1 rounded-2xl border border-border-subtle bg-white p-2 shadow-rest"
        >
          <div className="px-1 pt-1 pb-2">
            <p className="mb-2 px-2 text-xs font-semibold text-muted">{t.kindField}</p>
            <SegmentedChoice
              label={t.kindField}
              value={kind}
              onChange={setKind}
              options={kindOptions}
              className="w-full"
            />
            <p className="mt-2 px-2 text-xs leading-[17px] text-muted">{t.kindHints[kind]}</p>
          </div>
          {row('global', t.global, t.globalState, true)}
          {(products.data ?? []).length > 0 ? (
            <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">{t.products}</p>
          ) : null}
          {(products.data ?? []).map((p) =>
            row(p.productId, p.name, p.look.enabled ? t.ownState : t.inheritState, p.look.enabled),
          )}
          <div className="mx-1 my-2 border-t border-border-subtle" />
          {row('common', t.common, t.commonState, false)}
        </nav>
      </div>
      {picked === 'common' ? (
        <CommonForm
          initial={settings.data}
          senderAddress={look.data.senderAddress}
          inboundReady={look.data.inboundReady}
        />
      ) : (
        <LookForm
          key={`${kind}:${picked}:${product ? 'product' : 'global'}`}
          kind={kind}
          initial={product ? withoutEnabled(product.look) : global.data}
          product={
            product
              ? { id: product.productId, name: product.name, enabled: product.look.enabled }
              : null
          }
          companyName={company.data.name}
        />
      )}
    </div>
  );
}

const withoutEnabled = (own: LookFields & { enabled: boolean }): LookFields => {
  const { enabled, ...look } = own;
  void enabled;
  return look;
};

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 id={id} className="text-[15px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A look as text to compare: the database keeps a document's keys in an order of its own. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, part: unknown) =>
    part && typeof part === 'object' && !Array.isArray(part)
      ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b)))
      : part,
  );

/** Whether a one-line document has anything in it. */
const hasContent = (doc: EmailNode) =>
  (doc.content ?? []).some((line) => (line.content ?? []).length > 0);

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** „Spoločné nastavenia e-mailov“: the sending address and where replies go, for every look. */
function CommonForm({
  initial,
  senderAddress,
  inboundReady,
}: {
  initial: EmailSettings;
  senderAddress: string;
  inboundReady: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan('email_look.manage');
  const ids = useId();
  const [settings, setSettings] = useState(initial);
  const save = useMutation(
    trpc.template.updateEmailSettings.mutationOptions({
      onSuccess: async () => {
        toast('success', t.commonSaved);
        await queryClient.invalidateQueries(trpc.template.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.validation)),
    }),
  );
  const dirty =
    settings.replyMode !== initial.replyMode || settings.replyToAddress !== initial.replyToAddress;
  return (
    <div className="space-y-3">
      <Caption>{t.columns.settings}</Caption>
      <form
        className="space-y-6 rounded-2xl border border-border-subtle bg-white p-5 shadow-rest"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(settings);
        }}
      >
        <div>
          <h2 className="text-[17px] leading-[22px] font-semibold">{t.common}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{t.commonLead}</p>
        </div>
        <Section title={t.sender}>
          <div className="space-y-2">
            <Label htmlFor={`${ids}-address`}>{t.senderAddress}</Label>
            <Input id={`${ids}-address`} value={senderAddress} readOnly />
          </div>
        </Section>
        <Section title={t.replies}>
          <div role="radiogroup" aria-label={t.replies} className="space-y-2">
            {REPLY_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.replyMode === mode}
                disabled={!canManage}
                onClick={() => setSettings({ ...settings, replyMode: mode })}
                className={cn(
                  'block w-full rounded-xl border px-3.5 py-2.5 text-left',
                  settings.replyMode === mode
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:bg-hover',
                )}
              >
                <span
                  className={cn(
                    'block text-sm font-semibold',
                    settings.replyMode === mode ? 'text-primary-text' : 'text-foreground',
                  )}
                >
                  {t.replyModes[mode]}
                </span>
                <span className="block text-xs text-muted">{t.replyHints[mode]}</span>
              </button>
            ))}
          </div>
          {settings.replyMode === 'company' ? (
            <div className="space-y-2">
              <Label htmlFor={`${ids}-reply-to`}>{t.replyToAddress}</Label>
              <Input
                id={`${ids}-reply-to`}
                type="email"
                maxLength={120}
                value={settings.replyToAddress}
                disabled={!canManage}
                onChange={(event) =>
                  setSettings({ ...settings, replyToAddress: event.target.value })
                }
              />
            </div>
          ) : null}
          {settings.replyMode === 'intra' && !inboundReady ? (
            <p className="text-[13px] text-warning">{t.replyIntraNotReady}</p>
          ) : null}
        </Section>
        {canManage ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || save.isPending}>
              {t.commonSave}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}

/** „Prevziať“: fills the form from another look; nothing changes until the form is saved. */
function CopyDialog({
  kind,
  productId,
  target,
  onClose,
  onCopy,
}: {
  kind: LookKind;
  productId: string | null;
  target: string;
  onClose: () => void;
  onCopy: (look: LookFields) => void;
}) {
  const c = t.copy;
  const [from, setFrom] = useState<LookKind>(kind === 'personal' ? 'team' : 'personal');
  const [picked, setPicked] = useState<string>('global');
  const global = useQuery(trpc.template.globalLook.queryOptions({ kind: from }));
  const products = useQuery(trpc.template.productLooks.queryOptions({ kind: from }));
  const isCurrent = (id: string | null) => from === kind && id === productId;
  const options = [
    { id: 'global', name: t.global, state: t.globalState, current: isCurrent(null) },
    ...(products.data ?? []).map((p) => ({
      id: p.productId,
      name: p.name,
      state: p.look.enabled ? t.ownState : t.inheritState,
      current: isCurrent(p.productId),
    })),
  ];
  const chosen = options.find((option) => option.id === picked && !option.current);
  const source = () => {
    const product = products.data?.find((p) => p.productId === chosen?.id);
    return product?.look.enabled ? withoutEnabled(product.look) : global.data;
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.lead(target)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t.kindField}</p>
            <SegmentedChoice
              label={t.kindField}
              value={from}
              onChange={setFrom}
              options={kindOptions}
              className="w-full"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{c.look}</p>
            <div role="radiogroup" aria-label={c.look} className="space-y-1.5">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen?.id === option.id}
                  disabled={option.current}
                  onClick={() => setPicked(option.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left',
                    chosen?.id === option.id
                      ? 'border-primary bg-primary-soft'
                      : 'border-border hover:bg-hover',
                    option.current && 'cursor-default bg-surface text-muted hover:bg-surface',
                  )}
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold">{option.name}</span>
                  <span className="text-xs text-muted">
                    {option.current ? c.current : option.state}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <p className="rounded-xl bg-surface px-3 py-2.5 text-[13px] text-muted">{c.note}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            type="button"
            disabled={!chosen || !global.data}
            onClick={() => {
              const look = source();
              if (look) onCopy(look);
            }}
          >
            {c.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LookForm({
  kind,
  initial,
  product,
  companyName,
}: {
  kind: LookKind;
  initial: LookFields;
  product: { id: string; name: string; enabled: boolean } | null;
  companyName: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan('email_look.manage');
  const ids = useId();
  const logoInput = useRef<HTMLInputElement>(null);
  const [look, setLook] = useState<LookFields>(initial);
  const [enabled, setEnabled] = useState(product?.enabled ?? true);
  const [uploading, setUploading] = useState(false);
  const [pickingLogo, setPickingLogo] = useState(false);
  const [copying, setCopying] = useState(false);
  // The rich fields are remounted on „Prevziať“: an editor keeps its own text otherwise.
  const [filledAt, setFilledAt] = useState(0);
  const shown = useDebounced(look, 400);
  const preview = useQuery({
    ...trpc.template.lookPreview.queryOptions(shown),
    // A look that could not be saved stays as last shown.
    enabled: lookFieldsSchema.safeParse(shown).success,
    placeholderData: keepPreviousData,
  });
  const set = <K extends keyof LookFields>(key: K, value: LookFields[K]) =>
    setLook((current) => ({ ...current, [key]: value }));
  const save = useMutation(
    trpc.template.saveLook.mutationOptions({
      onSuccess: async () => {
        toast('success', t.saved);
        await queryClient.invalidateQueries(trpc.template.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.validation)),
    }),
  );
  const dirty = canonical(look) !== canonical(initial) || enabled !== (product?.enabled ?? true);
  const editable = !product || enabled;
  const title = t.lookTitle(t.kinds[kind], product ? product.name : t.globalName);

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const { key } = await uploadEmailImage(file);
      set('logoKey', key);
    } catch (error) {
      toast(
        'error',
        error instanceof ImageNotAllowed
          ? sk.templates.editor.imageNotAllowed
          : sk.templates.editor.imageFailed,
      );
    } finally {
      setUploading(false);
    }
  };

  const logoFromFile = async (fileId: string) => {
    setUploading(true);
    try {
      const { key } = await trpcClient.template.imageFromFile.mutate({ fileId });
      set('logoKey', key);
    } catch {
      toast('error', sk.templates.editor.fromFilesFailed);
    } finally {
      setUploading(false);
    }
  };

  const text = (key: 'brandName' | 'footerWeb' | 'footerEmail', label: string, max: number) => (
    <div className="space-y-2">
      <Label htmlFor={`${ids}-${key}`}>{label}</Label>
      <Input
        id={`${ids}-${key}`}
        maxLength={max}
        value={look[key]}
        disabled={!canManage}
        onChange={(event) => set(key, event.target.value)}
      />
    </div>
  );

  return (
    <>
      {pickingLogo ? (
        <FilePicker
          lead={sk.templates.editor.fromFilesLead}
          notes={[sk.templates.editor.fromFilesNote]}
          already={new Set()}
          imagePick={sk.templates.editor.fromFilesPick}
          onClose={() => setPickingLogo(false)}
          onPick={([file]) => {
            if (file) void logoFromFile(file.fileId);
          }}
        />
      ) : null}
      {copying ? (
        <CopyDialog
          kind={kind}
          productId={product?.id ?? null}
          target={title}
          onClose={() => setCopying(false)}
          onCopy={(source) => {
            setLook(source);
            setFilledAt((at) => at + 1);
            setCopying(false);
          }}
        />
      ) : null}
      <div className="space-y-3">
        <Caption>{t.columns.settings}</Caption>
        <form
          className="space-y-6 rounded-2xl border border-border-subtle bg-white p-5 shadow-rest"
          onSubmit={(event) => {
            event.preventDefault();
            const checked = lookFieldsSchema.safeParse(look);
            if (!checked.success) {
              const code = checked.error.issues[0]?.message ?? 'invalid';
              const words: Record<string, string> = sk.validation;
              toast('error', words[code] ?? sk.validation.invalid);
              return;
            }
            save.mutate({ kind, productId: product?.id ?? null, enabled, look });
          }}
        >
          <div>
            <h2 className="text-[17px] leading-[22px] font-semibold">{title}</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {product ? t.productLead : t.globalLead}
            </p>
          </div>
          {product ? (
            <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
              <Switch
                checked={enabled}
                label={t.ownSwitch}
                disabled={!canManage}
                onChange={() => setEnabled(!enabled)}
              />
              <span className="text-sm font-medium">
                {t.ownSwitch}
                <span className="block text-xs font-normal text-muted">
                  {enabled ? t.ownOn : t.ownOff}
                </span>
              </span>
            </div>
          ) : null}
          {editable ? (
            <>
              <Section title={t.header}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-subtle bg-surface">
                    {look.logoKey ? (
                      <img
                        src={`/m/${look.logoKey}`}
                        alt={t.logo}
                        className="max-h-full max-w-full"
                      />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-[1_1_12rem]">
                    <p className="text-sm font-medium">{t.logo}</p>
                    <p className="text-xs text-muted">{t.logoHint}</p>
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={uploading}
                        onClick={() => logoInput.current?.click()}
                      >
                        <Upload className="size-3.5" aria-hidden />
                        {look.logoKey ? t.logoChange : t.logoAdd}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={uploading}
                        onClick={() => setPickingLogo(true)}
                      >
                        {t.logoFromFiles}
                      </Button>
                      {look.logoKey ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => set('logoKey', null)}
                        >
                          {t.logoRemove}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <input
                    ref={logoInput}
                    type="file"
                    hidden
                    accept="image/png,image/jpeg"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void uploadLogo(file);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.headerStyle}</p>
                  <div role="radiogroup" aria-label={t.headerStyle} className="flex gap-2">
                    {HEADER_STYLES.map((style) => (
                      <button
                        key={style}
                        type="button"
                        role="radio"
                        aria-checked={look.headerStyle === style}
                        disabled={!canManage}
                        onClick={() => set('headerStyle', style)}
                        className={cn(
                          'inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-semibold',
                          look.headerStyle === style
                            ? 'border-primary bg-primary-soft text-primary-text'
                            : 'border-border text-muted hover:bg-hover',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'size-4 rounded-md border',
                            style === 'dark'
                              ? 'border-transparent bg-[#0c3b3c]'
                              : 'border-border bg-white',
                          )}
                        />
                        {t.headerStyles[style]}
                      </button>
                    ))}
                  </div>
                </div>
                {text('brandName', t.brandName, 60)}
                <div className="space-y-2">
                  <p id={`${ids}-header-text`} className="text-sm font-medium">
                    {t.headerText}
                  </p>
                  <EmailHeaderEditor
                    key={filledAt}
                    value={look.headerDoc}
                    onChange={(doc) => set('headerDoc', doc)}
                    labelledBy={`${ids}-header-text`}
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.accent}</p>
                  <div role="radiogroup" aria-label={t.accent} className="flex gap-2">
                    {ACCENT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        role="radio"
                        aria-checked={look.accent === color}
                        aria-label={t.accentOption(color)}
                        disabled={!canManage}
                        onClick={() => set('accent', color)}
                        className={cn(
                          'inline-flex size-9 items-center justify-center rounded-full ring-offset-2 transition-shadow',
                          look.accent === color && 'ring-2 ring-primary',
                        )}
                        style={{ backgroundColor: color }}
                      >
                        {look.accent === color ? (
                          <Check className="size-4 text-white" aria-hidden />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title={t.sender}>
                <EmailSubjectEditor
                  key={filledAt}
                  value={look.senderNameDoc ?? { type: 'doc', content: [{ type: 'paragraph' }] }}
                  onChange={(doc) => set('senderNameDoc', hasContent(doc) ? doc : null)}
                  fields={[]}
                  labelledBy={`${ids}-sender`}
                  label={t.senderName}
                />
                <p className="text-[13px] text-muted">
                  {t.senderHint}{' '}
                  {t.senderDefault(
                    senderNameOf({ ...look, footerCompany: companyName, senderNameDoc: null }),
                  )}
                </p>
              </Section>

              <Section title={t.signature} id={`${ids}-signature`}>
                <EmailLookDocEditor
                  key={filledAt}
                  value={look.signatureDoc}
                  onChange={(doc) => set('signatureDoc', doc)}
                  labelledBy={`${ids}-signature`}
                  groups={SIGNATURE_VARIABLES}
                  disabled={!canManage}
                />
                <p className="text-xs leading-[17px] text-muted">{t.lineHint}</p>
              </Section>

              <Section title={t.footer} id={`${ids}-footer`}>
                <EmailLookDocEditor
                  key={filledAt}
                  value={look.footerDoc}
                  onChange={(doc) => set('footerDoc', doc)}
                  labelledBy={`${ids}-footer`}
                  groups={FOOTER_VARIABLES}
                  standard="center"
                  disabled={!canManage}
                />
                <p className="text-xs leading-[17px] text-muted">{t.footerHint}</p>
                <div className="grid grid-cols-2 gap-3">
                  {text('footerWeb', t.footerWeb, 120)}
                  {text('footerEmail', t.footerEmail, 120)}
                </div>
              </Section>
            </>
          ) : null}

          {canManage ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dirty ? <span className="mr-auto text-[13px] text-muted">{t.unsaved}</span> : null}
              {editable ? (
                <Button type="button" variant="secondary" onClick={() => setCopying(true)}>
                  {t.copy.button}
                </Button>
              ) : null}
              <Button type="submit" disabled={!dirty || save.isPending || uploading}>
                {t.save}
              </Button>
            </div>
          ) : null}
        </form>
      </div>

      <div className="min-w-0 space-y-3">
        <Caption>{editable ? t.columns.preview : t.previewInherit}</Caption>
        <section className="overflow-hidden rounded-2xl border border-border-subtle bg-[#e9eeee] shadow-rest">
          {preview.data ? (
            <iframe
              title={t.columns.preview}
              sandbox="allow-same-origin"
              srcDoc={preview.data.html}
              className="block h-[760px] w-full border-0"
            />
          ) : (
            <div className="p-5">
              <CardSkeleton lines={8} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
