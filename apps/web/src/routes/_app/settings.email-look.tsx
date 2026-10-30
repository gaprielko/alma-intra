import { sk } from '@intra/shared/i18n';
import { ACCENT_COLORS, type EmailLook, HEADER_STYLES, REPLY_MODES } from '@intra/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { FilePicker } from '@/components/files/file-picker';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function EmailLookPage() {
  const look = useQuery(trpc.template.look.queryOptions());
  if (look.isPending) {
    return (
      <div className="grid gap-5 px-7 pt-5 pb-10 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <CardSkeleton lines={8} />
        <CardSkeleton lines={10} />
      </div>
    );
  }
  if (loadFailed(look)) return <ErrorState onRetry={() => void look.refetch()} />;
  return (
    <Looks
      global={look.data.look}
      senderAddress={look.data.senderAddress}
      inboundReady={look.data.inboundReady}
    />
  );
}

/** Which look is being set: the global one, or a product's, from the rail at the left. */
function Looks({
  global,
  senderAddress,
  inboundReady,
}: {
  global: EmailLook;
  senderAddress: string;
  inboundReady: boolean;
}) {
  const products = useQuery(trpc.template.productLooks.queryOptions());
  const [picked, setPicked] = useState<string | null>(null);
  const product = products.data?.find((p) => p.productId === picked) ?? null;
  const row = (id: string | null, name: string, state: string, on: boolean) => (
    <button
      key={id ?? 'global'}
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
      <nav
        aria-label={t.looks}
        className="space-y-1 rounded-2xl border border-border-subtle bg-white p-2 shadow-rest"
      >
        {row(null, t.global, t.globalState, true)}
        {(products.data ?? []).length > 0 ? (
          <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">{t.products}</p>
        ) : null}
        {(products.data ?? []).map((p) =>
          row(p.productId, p.name, p.look.enabled ? t.ownState : t.inheritState, p.look.enabled),
        )}
      </nav>
      <LookForm
        key={picked ?? 'global'}
        initial={product ? { ...global, ...product.look } : global}
        product={
          product
            ? { id: product.productId, name: product.name, enabled: product.look.enabled }
            : null
        }
        senderAddress={senderAddress}
        inboundReady={inboundReady}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
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

function LookForm({
  initial,
  product,
  senderAddress,
  inboundReady,
}: {
  initial: EmailLook;
  product: { id: string; name: string; enabled: boolean } | null;
  senderAddress: string;
  inboundReady: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan('email_look.manage');
  const ids = useId();
  const logoInput = useRef<HTMLInputElement>(null);
  const [look, setLook] = useState<EmailLook>(initial);
  const [enabled, setEnabled] = useState(product?.enabled ?? true);
  const [uploading, setUploading] = useState(false);
  const [pickingLogo, setPickingLogo] = useState(false);
  const shown = useDebounced(look, 400);
  const preview = useQuery({
    ...trpc.template.lookPreview.queryOptions(shown),
    placeholderData: keepPreviousData,
  });
  const set = <K extends keyof EmailLook>(key: K, value: EmailLook[K]) =>
    setLook((current) => ({ ...current, [key]: value }));
  const save = useMutation(
    trpc.template.updateLook.mutationOptions({
      onSuccess: async () => {
        toast('success', t.saved);
        await queryClient.invalidateQueries(trpc.template.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.validation)),
    }),
  );
  const saveProduct = useMutation(
    trpc.template.saveProductLook.mutationOptions({
      onSuccess: async () => {
        toast('success', t.saved);
        await queryClient.invalidateQueries(trpc.template.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.validation)),
    }),
  );
  const dirty =
    JSON.stringify(look) !== JSON.stringify(initial) || enabled !== (product?.enabled ?? true);
  const editable = !product || enabled;

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

  const text = (
    key: 'brandName' | 'headerText' | 'footerCompany' | 'footerIco' | 'footerWeb' | 'footerEmail',
    label: string,
    max: number,
  ) => (
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
      <form
        className="space-y-6 rounded-2xl border border-border-subtle bg-white p-5 shadow-rest"
        onSubmit={(event) => {
          event.preventDefault();
          if (product) {
            saveProduct.mutate({
              productId: product.id,
              look: {
                enabled,
                logoKey: look.logoKey,
                headerStyle: look.headerStyle,
                brandName: look.brandName,
                headerText: look.headerText,
                accent: look.accent,
                footerWeb: look.footerWeb,
                footerEmail: look.footerEmail,
              },
            });
          } else {
            save.mutate(look);
          }
        }}
      >
        <p className="text-[13px] text-muted">
          {product ? t.productLead(product.name) : t.globalLead}
        </p>
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
              <div className="flex items-center gap-3">
                <span className="inline-flex size-14 items-center justify-center overflow-hidden rounded-xl border border-border-subtle bg-surface">
                  {look.logoKey ? (
                    <img
                      src={`/m/${look.logoKey}`}
                      alt={t.logo}
                      className="max-h-full max-w-full"
                    />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.logo}</p>
                  <p className="text-xs text-muted">{t.logoHint}</p>
                </div>
                {canManage ? (
                  <div className="flex gap-1">
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
              {text('headerText', t.headerText, 120)}
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
              <div className="space-y-2">
                <Label htmlFor={`${ids}-address`}>{t.senderAddress}</Label>
                <Input id={`${ids}-address`} value={senderAddress} readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${ids}-sender`}>{t.senderName}</Label>
                <Input id={`${ids}-sender`} value={t.senderNameValue(look.brandName)} readOnly />
              </div>
              <p className="text-[13px] text-muted">{t.senderHint(look.brandName)}</p>
            </Section>

            {product ? (
              <Section title={t.footer}>
                <div className="grid grid-cols-2 gap-3">
                  {text('footerWeb', t.footerWeb, 120)}
                  {text('footerEmail', t.footerEmail, 120)}
                </div>
                <p className="rounded-xl bg-surface px-3 py-2.5 text-[13px] text-muted">
                  {t.commonNote}
                </p>
              </Section>
            ) : (
              <>
                <Section title={t.replies}>
                  <div role="radiogroup" aria-label={t.replies} className="space-y-2">
                    {REPLY_MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={look.replyMode === mode}
                        disabled={!canManage}
                        onClick={() => set('replyMode', mode)}
                        className={cn(
                          'block w-full rounded-xl border px-3.5 py-2.5 text-left',
                          look.replyMode === mode
                            ? 'border-primary bg-primary-soft'
                            : 'border-border hover:bg-hover',
                        )}
                      >
                        <span
                          className={cn(
                            'block text-sm font-semibold',
                            look.replyMode === mode ? 'text-primary-text' : 'text-foreground',
                          )}
                        >
                          {t.replyModes[mode]}
                        </span>
                        <span className="block text-xs text-muted">{t.replyHints[mode]}</span>
                      </button>
                    ))}
                  </div>
                  {look.replyMode === 'company' ? (
                    <div className="space-y-2">
                      <Label htmlFor={`${ids}-reply-to`}>{t.replyToAddress}</Label>
                      <Input
                        id={`${ids}-reply-to`}
                        type="email"
                        maxLength={120}
                        value={look.replyToAddress}
                        disabled={!canManage}
                        onChange={(event) => set('replyToAddress', event.target.value)}
                      />
                    </div>
                  ) : null}
                  {look.replyMode === 'intra' && !inboundReady ? (
                    <p className="text-[13px] text-warning">{t.replyIntraNotReady}</p>
                  ) : null}
                </Section>

                <Section title={t.footer}>
                  {text('footerCompany', t.footerCompany, 200)}
                  <div className="grid grid-cols-2 gap-3">
                    {text('footerIco', t.footerIco, 20)}
                    {text('footerWeb', t.footerWeb, 120)}
                  </div>
                  {text('footerEmail', t.footerEmail, 120)}
                </Section>
              </>
            )}
          </>
        ) : null}

        {canManage ? (
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!dirty || save.isPending || saveProduct.isPending || uploading}
            >
              {t.save}
            </Button>
          </div>
        ) : null}
      </form>

      <section className="overflow-hidden rounded-2xl border border-border-subtle bg-[#e9eeee] shadow-rest">
        <h2 className="border-b border-border-subtle bg-white px-5 py-3 text-[15px] font-semibold">
          {t.preview}
        </h2>
        {preview.data ? (
          <iframe
            title={t.preview}
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
    </>
  );
}
