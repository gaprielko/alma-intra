import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { BrandCardTitle, brandCardClass } from '@/components/brand-panel';
import { CodeBoxes, RecoveryCodes, TotpQr } from '@/components/second-factor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { trpc, trpcClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.auth;
const ts = sk.auth.secondStep;
const tf = sk.secondFactor;

/** What the right password still owes: a code, or the setup of the authenticator. */
export type SecondStep = { kind: 'verify' | 'enrol'; challenge: string };

export const alertClass = 'mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger';

interface StepProps {
  challenge: string;
  onDone: () => Promise<void>;
  /** Back to the password; `expired` when the five minutes of the challenge ran out. */
  onRestart: (expired: boolean) => void;
}

const isExpired = (error: unknown) => errorMessage(error, { CHALLENGE_EXPIRED: 'x' }, '') === 'x';

function RememberDevice({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor="remember-device" className="mt-5 flex items-center gap-3 text-sm font-medium">
      <Checkbox
        id="remember-device"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {ts.remember}
    </label>
  );
}

function BackToLogin({ onRestart }: { onRestart: StepProps['onRestart'] }) {
  return (
    <button
      type="button"
      className="font-medium text-muted hover:underline"
      onClick={() => onRestart(false)}
    >
      {ts.back}
    </button>
  );
}

/**
 * The three steps of a first sign-in (password, phone, recovery codes): done ones ticked, the
 * current one in the brand colour.
 */
export function EnrolSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs font-medium">
      {t.enrol.steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          {i > 0 ? <span aria-hidden className="h-px w-5 bg-border" /> : null}
          <span
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex size-5 items-center justify-center rounded-full border text-[11px]',
              i < current && 'border-primary bg-primary text-white',
              i === current && 'border-primary text-primary-text',
              i > current && 'border-border text-tertiary',
            )}
          >
            {i < current ? <Check className="size-3" aria-hidden /> : i + 1}
          </span>
          <span className={i === current ? 'text-foreground' : 'text-tertiary'}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** The code of her authenticator, or a recovery code when the phone is not at hand. */
export function VerifyStep({ challenge, onDone, onRestart }: StepProps) {
  const toast = useToast();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const verify = useMutation(
    trpc.auth.secondFactorVerify.mutationOptions({
      onSuccess: async (answer) => {
        if (answer.method === 'recovery_code')
          toast('info', ts.recoveryLeft(answer.recoveryCodesLeft));
        await onDone();
      },
      onError: (error) => {
        if (isExpired(error)) onRestart(true);
      },
    }),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate({ challenge, code, rememberDevice: remember });
  };
  const errors = {
    WRONG_CODE: recovery ? ts.wrongRecoveryCode : ts.wrongCode,
    TOO_MANY_REQUESTS: t.tooManyAttempts,
    USER_DEACTIVATED: t.deactivated,
  };
  const wrong = verify.isError && !isExpired(verify.error);

  return (
    <form noValidate className={brandCardClass} onSubmit={submit}>
      <BrandCardTitle title={ts.title} text={recovery ? ts.recoverySubtitle : ts.subtitle} />
      {wrong ? (
        <p role="alert" className={alertClass}>
          {errorMessage(verify.error, errors, t.genericError)}
        </p>
      ) : null}
      <div className="mt-6">
        {recovery ? (
          <>
            <Label htmlFor="second-step-code">{ts.recoveryCode}</Label>
            <Input
              id="second-step-code"
              className="font-mono"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={20}
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </>
        ) : (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{ts.code}</legend>
            <CodeBoxes
              value={code}
              onChange={setCode}
              invalid={wrong}
              autoFocus
              labelOf={ts.digit}
            />
          </fieldset>
        )}
      </div>
      <RememberDevice checked={remember} onChange={setRemember} />
      <Button
        type="submit"
        size="lg"
        className="mt-6 w-full"
        disabled={verify.isPending || (recovery ? code.trim().length < 10 : code.length !== 6)}
      >
        {verify.isPending ? ts.verifying : ts.verify}
      </Button>
      <div className="mt-4 flex justify-between gap-4 text-sm">
        <button
          type="button"
          className="font-medium text-primary-text hover:underline"
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
            verify.reset();
          }}
        >
          {recovery ? ts.useApp : ts.useRecovery}
        </button>
        <BackToLogin onRestart={onRestart} />
      </div>
    </form>
  );
}

/**
 * The first sign-in, or the first after a colleague reset her factor: the authenticator before
 * anything else. The QR code and the key, its first code, then the recovery codes; the session is
 * already there when they show.
 */
export function EnrolStep({ challenge, onDone, onRestart }: StepProps) {
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  // A mutation on the server (it writes the waiting secret), asked once per challenge: a query so
  // that a remount (StrictMode) does not make a second secret behind the QR shown.
  const setup = useQuery({
    queryKey: ['auth.secondFactorSetup', challenge],
    queryFn: () => trpcClient.auth.secondFactorSetup.mutate({ challenge }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const enrol = useMutation(
    trpc.auth.secondFactorEnrol.mutationOptions({
      onSuccess: (answer) => setRecoveryCodes(answer.recoveryCodes),
      onError: (error) => {
        if (isExpired(error)) onRestart(true);
      },
    }),
  );
  const setupExpired = setup.isError && isExpired(setup.error);
  useEffect(() => {
    if (setupExpired) onRestart(true);
  }, [setupExpired, onRestart]);
  const wrong = enrol.isError && !isExpired(enrol.error);

  if (recoveryCodes) {
    return (
      <section className={cn(brandCardClass, 'max-w-[34rem]')}>
        <EnrolSteps current={2} />
        <BrandCardTitle title={tf.recovery.title} />
        <div className="mt-4">
          <RecoveryCodes codes={recoveryCodes} onDone={() => void onDone()} />
        </div>
      </section>
    );
  }

  return (
    <form
      noValidate
      className={cn(brandCardClass, 'max-w-[34rem]')}
      onSubmit={(event) => {
        event.preventDefault();
        enrol.mutate({ challenge, code, rememberDevice: remember });
      }}
    >
      <EnrolSteps current={1} />
      <BrandCardTitle title={t.enrol.title} text={t.enrol.intro} />
      {wrong ? (
        <p role="alert" className={alertClass}>
          {errorMessage(
            enrol.error,
            { ...tf.errors, TOO_MANY_REQUESTS: t.tooManyAttempts },
            t.genericError,
          )}
        </p>
      ) : null}
      {setup.isError && !setupExpired ? (
        <p role="alert" className={alertClass}>
          {errorMessage(setup.error, tf.errors, t.genericError)}
        </p>
      ) : null}
      <div className="mt-5">
        {setup.data ? (
          <TotpQr uri={setup.data.otpauthUri} secret={setup.data.secret} />
        ) : (
          <p className="text-sm text-muted" role="status">
            {tf.preparing}
          </p>
        )}
      </div>
      <fieldset className="mt-6 max-w-[22rem]">
        <legend className="mb-2 text-sm font-medium">{tf.code}</legend>
        <CodeBoxes value={code} onChange={setCode} invalid={wrong} labelOf={ts.digit} />
      </fieldset>
      <RememberDevice checked={remember} onChange={setRemember} />
      <Button
        type="submit"
        size="lg"
        className="mt-6 w-full"
        disabled={!setup.data || enrol.isPending || code.length !== 6}
      >
        {enrol.isPending ? tf.confirming : tf.confirm}
      </Button>
      <p className="mt-4 text-xs text-muted">{t.enrol.lostPhone}</p>
      <div className="mt-3 flex justify-end text-sm">
        <BackToLogin onRestart={onRestart} />
      </div>
    </form>
  );
}
