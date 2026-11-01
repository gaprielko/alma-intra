import { sk } from '@intra/shared/i18n';
import {
  fileExtension,
  SHARE_MODES,
  SHARE_PASSWORD_MIN,
  type ShareMode,
} from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { inputClass } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.sharing.dialog;

/** A password nobody has to think of: readable, 16 characters from the CSPRNG. */
function generatedPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

/**
 * „Zdieľať“ of a file: its one public link. A password can be replaced but never shown again, so a
 * generated one is left in the field to copy until the dialog closes.
 */
export function ShareDialog({
  file,
  onClose,
}: {
  file: { id: string; name: string; folderPath?: string | null };
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const share = useQuery(trpc.fileShare.get.queryOptions({ fileId: file.id }));
  const details = useQuery(trpc.file.get.queryOptions({ id: file.id }));
  const html = fileExtension(file.name) === 'html';
  const [mode, setMode] = useState<ShareMode>('read');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [expiresOn, setExpiresOn] = useState('');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!share.data) return;
    setMode(share.data.mode);
    setExpiresOn(share.data.expiresOn ?? '');
  }, [share.data]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.fileShare.pathFilter()),
      queryClient.invalidateQueries(trpc.file.pathFilter()),
    ]);
  const save = useMutation(
    trpc.fileShare.save.mutationOptions({
      onSuccess: async () => {
        toast('success', t.saved);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error, sk.sharing.errors)),
    }),
  );
  const cancel = useMutation(
    trpc.fileShare.cancel.mutationOptions({
      onSuccess: async () => {
        toast('success', t.cancelled);
        await refresh();
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, sk.sharing.errors)),
    }),
  );

  const typed = password.length > 0;
  const tooShort = typed && password.length < SHARE_PASSWORD_MIN;
  const hasPassword = share.data?.hasPassword ?? false;
  const missing = mode !== 'read' && !typed && !hasPassword;
  const copy = async () => {
    if (!share.data) return;
    await navigator.clipboard.writeText(share.data.url);
    toast('success', t.copied);
  };
  const inCustomerFolder = details.data?.path[0]?.customerId != null;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent size="md" className="gap-0 p-0">
        <div className="px-6 pt-5 pb-2 pr-14">
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription className="break-words">{file.name}</DialogDescription>
        </div>
        <form
          className="space-y-[18px] px-6 pt-3 pb-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (tooShort || missing) return;
            save.mutate({
              fileId: file.id,
              mode,
              ...(typed ? { password } : {}),
              expiresOn: expiresOn || null,
            });
          }}
        >
          <div>
            <p className="text-[13px] font-semibold">{t.link}</p>
            {share.data ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                <input
                  readOnly
                  aria-label={t.link}
                  value={share.data.url}
                  className={cn(inputClass, 'h-10 min-w-[14rem] flex-1 text-sm')}
                />
                <Button type="button" variant="secondary" onClick={() => void copy()}>
                  <Copy className="size-4" aria-hidden />
                  {t.copy}
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-muted">{t.linkLater}</p>
            )}
          </div>

          {html ? (
            <div>
              <p className="text-[13px] font-semibold" id="share-mode">
                {t.mode}
              </p>
              <div
                role="radiogroup"
                aria-labelledby="share-mode"
                className="mt-1.5 flex gap-0.5 rounded-[10px] bg-track p-[3px]"
              >
                {SHARE_MODES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => setMode(value)}
                    className={cn(
                      'h-9 flex-1 rounded-lg text-sm font-semibold text-muted',
                      mode === value && 'bg-white text-primary-text shadow-rest',
                    )}
                  >
                    {t.modes[value]}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">{t.modeHints[mode]}</p>
            </div>
          ) : null}

          <div>
            <label className="block text-[13px] font-semibold" htmlFor="share-password">
              {mode === 'read' ? t.passwordOptional : t.password}
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                id="share-password"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                aria-invalid={tooShort || missing}
                onChange={(event) => {
                  setReveal(false);
                  setPassword(event.target.value);
                }}
                className={cn(inputClass, 'h-10 min-w-[14rem] flex-1 text-sm')}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPassword(generatedPassword());
                  setReveal(true);
                }}
              >
                {t.generate}
              </Button>
              {reveal && typed ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void navigator.clipboard.writeText(password)}
                  aria-label={t.copy}
                >
                  <Copy className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
            <p className={cn('mt-1.5 text-[13px] text-muted', tooShort && 'text-danger')}>
              {tooShort
                ? t.passwordShort
                : hasPassword
                  ? t.passwordSet
                  : mode === 'read'
                    ? t.passwordHint
                    : t.passwordRequired}
            </p>
            {hasPassword && mode === 'read' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() =>
                  save.mutate({
                    fileId: file.id,
                    mode,
                    password: null,
                    expiresOn: expiresOn || null,
                  })
                }
              >
                {t.removePassword}
              </Button>
            ) : null}
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-semibold">{t.expires}</p>
            <DatePicker label={t.expires} value={expiresOn} onChange={setExpiresOn} />
            <p className="mt-1.5 text-[13px] text-muted">{t.expiresHint}</p>
          </div>

          {inCustomerFolder ? (
            <p
              role="note"
              className="rounded-[10px] bg-warning-soft px-3 py-2.5 text-[13px] text-warning"
            >
              {t.personalData}
            </p>
          ) : null}

          <div className="-mx-6 -mb-5 flex flex-wrap gap-2 border-t border-border-subtle px-6 py-4">
            {share.data ? (
              <Button type="button" variant="ghost" onClick={() => setCancelling(true)}>
                {t.cancel}
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button type="button" variant="secondary" onClick={onClose}>
              {t.close}
            </Button>
            <Button type="submit" disabled={save.isPending || tooShort || missing}>
              {t.save}
            </Button>
          </div>
        </form>
      </DialogContent>
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t.cancelConfirm.title}
        description={t.cancelConfirm.text}
        confirmLabel={t.cancelConfirm.confirm}
        destructive
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate({ fileId: file.id })}
      />
    </Dialog>
  );
}
