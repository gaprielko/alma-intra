import { sk } from '@intra/shared/i18n';
import qrcode from 'qrcode-generator';
import { useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const t = sk.secondFactor;

/** The `otpauth://` URI as an SVG data URL (level M). */
function qrDataUrl(text: string) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code.createDataURL(5, 2);
}

/** `JBSW Y3DP …`: the key in groups of four, as authenticator apps show it. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * The secret of a new authenticator: the QR code to scan, and the key as text for a phone that
 * cannot scan it, with the three steps beside it. Shown once, never stored in the browser.
 */
export function TotpQr({ uri, secret }: { uri: string; secret: string }) {
  const src = useMemo(() => qrDataUrl(uri), [uri]);
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="shrink-0 rounded-[14px] border border-border-subtle bg-white p-3">
        <img src={src} alt={t.qrAlt} className="size-[142px]" />
      </div>
      <ol className="min-w-[240px] flex-1 list-decimal space-y-2.5 pl-5 text-sm leading-[21px]">
        <li>{t.instructions[0]}</li>
        <li>
          {t.instructions[1]}
          <code className="mt-1.5 block w-fit rounded-lg border border-border-subtle bg-subtle px-2 py-1 font-mono text-[13px] tracking-wider select-all">
            {grouped(secret)}
          </code>
        </li>
        <li>{t.instructions[2]}</li>
      </ol>
    </div>
  );
}

/**
 * Six boxes for the six digits of the authenticator. Typing moves on, Backspace moves back, and a
 * pasted code (or a password manager's one-time-code autofill) fills them all.
 */
export function CodeBoxes({
  value,
  onChange,
  invalid,
  autoFocus,
  labelOf,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  labelOf: (n: number) => string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const focus = (i: number) => refs.current[Math.max(0, Math.min(5, i))]?.focus();
  const set = (i: number, typed: string) => {
    const only = typed.replace(/\D/g, '');
    if (only.length > 1) {
      onChange(only.slice(0, 6));
      focus(only.length);
      return;
    }
    const next = [...digits];
    next[i] = only;
    onChange(next.join('').slice(0, 6));
    if (only) focus(i + 1);
  };
  return (
    <div className="flex justify-between gap-2">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(element) => {
            refs.current[i] = element;
          }}
          aria-label={labelOf(i + 1)}
          aria-invalid={invalid}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          maxLength={i === 0 ? 6 : 1}
          value={digit}
          onChange={(event) => set(i, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digit) focus(i - 1);
            if (event.key === 'ArrowLeft') focus(i - 1);
            if (event.key === 'ArrowRight') focus(i + 1);
          }}
          className={cn(
            'h-[60px] w-[52px] rounded-xl border border-border bg-white text-center text-2xl font-semibold text-foreground transition-[border-color,box-shadow] outline-none focus:border-2 focus:border-primary focus:shadow-[0_0_0_4px_rgba(15,139,141,0.12)]',
            invalid && 'border-danger',
          )}
        />
      ))}
    </div>
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
