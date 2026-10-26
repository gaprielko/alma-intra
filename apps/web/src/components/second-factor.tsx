import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { type FormEvent, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { trpc } from '@/lib/trpc';

const t = sk.secondFactor;

/** The `otpauth://` URI as an SVG data URL, like the intake's QR code (level M). */
function qrDataUrl(text: string) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code.createDataURL(5, 2);
}

/** `JBSW Y3DP …`: the key in groups of four, as authenticator apps show it. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * The secret of a new authenticator (ALMA-91): the QR code to scan, and the key as text for a
 * phone that cannot scan it. Shown once, never stored in the browser.
 */
export function TotpQr({ uri, secret }: { uri: string; secret: string }) {
  const src = useMemo(() => qrDataUrl(uri), [uri]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t.setup.scan}</p>
      <img src={src} alt={t.setup.qrAlt} className="mx-auto size-44" />
      <div>
        <p className="text-xs text-muted">{t.setup.manual}</p>
        <p className="mt-1 rounded-xl bg-surface px-3 py-2 text-center font-mono text-sm tracking-wider select-all">
          {grouped(secret)}
        </p>
      </div>
    </div>
  );
}

/** Six digits: the phone's numeric keyboard, and a password manager's one-time-code autofill. */
export function TotpCodeInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string | undefined;
}) {
  return (
    <Input
      id={id}
      className="mt-2 font-mono tracking-[0.3em]"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      required
      aria-invalid={invalid}
      aria-describedby={describedBy}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
    />
  );
}

/** The recovery codes, shown once after a setup; she confirms she has kept them. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t.recovery.intro}</p>
      <ol className="grid grid-cols-2 gap-2 rounded-xl bg-surface p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void navigator.clipboard
              .writeText(codes.join('\n'))
              .then(() => toast('success', t.recovery.copied))
              .catch(() => undefined)
          }
        >
          {t.recovery.copy}
        </Button>
        <Button type="button" onClick={onDone}>
          {t.recovery.done}
        </Button>
      </div>
    </div>
  );
}

/**
 * The factor in force, before it is moved or switched off (review S5): a code of the app, or one
 * of her recovery codes when the phone is the thing she lost.
 */
function CurrentCodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label htmlFor="second-factor-current-code">{t.setup.currentCode}</Label>
      <Input
        id="second-factor-current-code"
        className="font-mono"
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={20}
        aria-describedby="second-factor-current-code-hint"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id="second-factor-current-code-hint" className="mt-1 text-xs text-muted">
        {t.setup.currentCodeHint}
      </p>
    </div>
  );
}

type SetupStage =
  | { stage: 'password' }
  | { stage: 'scan'; secret: string; otpauthUri: string }
  | { stage: 'codes'; recoveryCodes: string[] };

/**
 * „Zapnúť“ / „Nastaviť na novom telefóne“: her password, the QR code and its first code, then the
 * recovery codes. Its forms live in a portal but inside the settings form in React's tree, so each
 * submit stops there: it must never also save the settings.
 */
function SetupDialog({
  open,
  replacing,
  onOpenChange,
}: {
  open: boolean;
  replacing: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [stage, setStage] = useState<SetupStage>({ stage: 'password' });
  const [password, setPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [code, setCode] = useState('');
  const setup = useMutation(
    trpc.account.secondFactorSetup.mutationOptions({
      onSuccess: (made) => setStage({ stage: 'scan', ...made }),
    }),
  );
  const confirm = useMutation(
    trpc.account.secondFactorConfirm.mutationOptions({
      onSuccess: async ({ recoveryCodes }) => {
        setStage({ stage: 'codes', recoveryCodes });
        await queryClient.invalidateQueries({
          queryKey: trpc.account.secondFactorStatus.queryKey(),
        });
      },
    }),
  );

  const close = () => {
    setStage({ stage: 'password' });
    setPassword('');
    setCurrentCode('');
    setCode('');
    setup.reset();
    confirm.reset();
    onOpenChange(false);
  };
  const submit = (event: FormEvent, run: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    run();
  };
  const error = setup.error ?? confirm.error;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {stage.stage === 'codes'
              ? t.recovery.title
              : replacing
                ? t.setup.replaceTitle
                : t.setup.enableTitle}
          </DialogTitle>
          {stage.stage === 'password' ? (
            <DialogDescription>{t.setup.passwordIntro}</DialogDescription>
          ) : null}
        </DialogHeader>

        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {errorMessage(error, t.errors, t.errors.generic)}
          </p>
        ) : null}

        {stage.stage === 'password' ? (
          <form
            noValidate
            onSubmit={(event) =>
              submit(event, () =>
                setup.mutate(replacing ? { password, code: currentCode } : { password }),
              )
            }
            className="space-y-4"
          >
            <div>
              <Label htmlFor="second-factor-password">{t.setup.password}</Label>
              <Input
                id="second-factor-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {replacing ? <CurrentCodeField value={currentCode} onChange={setCurrentCode} /> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {t.setup.cancel}
              </Button>
              <Button
                type="submit"
                disabled={
                  setup.isPending ||
                  password.length === 0 ||
                  (replacing && currentCode.trim().length < 6)
                }
              >
                {t.setup.continue}
              </Button>
            </DialogFooter>
          </form>
        ) : stage.stage === 'scan' ? (
          <form
            noValidate
            onSubmit={(event) => submit(event, () => confirm.mutate({ code }))}
            className="space-y-4"
          >
            <TotpQr uri={stage.otpauthUri} secret={stage.secret} />
            <div>
              <Label htmlFor="second-factor-code">{t.setup.code}</Label>
              <TotpCodeInput
                id="second-factor-code"
                value={code}
                onChange={setCode}
                describedBy="second-factor-code-hint"
              />
              <p id="second-factor-code-hint" className="mt-1 text-xs text-muted">
                {replacing ? t.setup.replaceNote : t.setup.codeHint}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {t.setup.cancel}
              </Button>
              <Button type="submit" disabled={confirm.isPending || code.length !== 6}>
                {confirm.isPending ? t.setup.confirming : t.setup.confirm}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <RecoveryCodes
            codes={stage.recoveryCodes}
            onDone={() => {
              toast('success', t.enabled);
              close();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** „Vypnúť“: her password, then the factor, its codes and its trusted browsers are gone. */
function DisableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const disable = useMutation(
    trpc.account.secondFactorDisable.mutationOptions({
      onSuccess: async () => {
        toast('success', t.disabled);
        setPassword('');
        setCode('');
        onOpenChange(false);
        await queryClient.invalidateQueries({
          queryKey: trpc.account.secondFactorStatus.queryKey(),
        });
      },
    }),
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPassword('');
          setCode('');
          disable.reset();
        }
        onOpenChange(next);
      }}
      title={t.disableDialog.title}
      description={t.disableDialog.body}
      confirmLabel={t.disableDialog.confirm}
      pending={disable.isPending}
      onConfirm={() => disable.mutate({ password, code })}
    >
      <div className="space-y-2">
        <Label htmlFor="second-factor-disable-password">{t.setup.password}</Label>
        <Input
          id="second-factor-disable-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <CurrentCodeField value={code} onChange={setCode} />
        {disable.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(disable.error, t.errors, t.errors.generic)}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

/**
 * „Bezpečnosť“ on „Môj účet“ (Figma HS-N1d, ALMA-91): whether her login has a second factor, and
 * the buttons to switch it on, move it to a new phone or switch it off (never the operator's).
 * Hidden for somebody who is offered none and has none: a nurse.
 */
export function SecondFactorCard() {
  const status = useQuery(trpc.account.secondFactorStatus.queryOptions());
  const isNurse = useSession((s) => s.actor?.membership.roles.includes('nurse') ?? false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const s = status.data;
  if (!s || (!s.offered && !s.enabled)) return null;

  return (
    <Card>
      <CardHeader title={t.title} />
      <div className="space-y-3 p-5">
        <div className="rounded-xl bg-surface px-3 py-2.5">
          <p className="text-sm font-medium">{t.tile}</p>
          <p className="mt-0.5 text-xs text-muted">
            {s.enabled && s.confirmedAt
              ? t.on(formatDate(new Date(s.confirmedAt).toISOString()), s.recoveryCodesLeft)
              : t.off}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {s.required ? t.requiredNote : t.optionalNote}
          </p>
          {isNurse ? <p className="mt-0.5 text-xs text-muted">{t.mobileNote}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {s.offered ? (
            <Button
              type="button"
              variant={s.enabled ? 'secondary' : 'primary'}
              onClick={() => setSetupOpen(true)}
            >
              {s.enabled ? t.replace : t.enable}
            </Button>
          ) : null}
          {s.enabled && !s.required ? (
            <Button
              type="button"
              variant="ghost"
              className="text-danger"
              onClick={() => setDisableOpen(true)}
            >
              {t.disable}
            </Button>
          ) : null}
        </div>
      </div>
      <SetupDialog open={setupOpen} replacing={s.enabled} onOpenChange={setSetupOpen} />
      <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
    </Card>
  );
}
