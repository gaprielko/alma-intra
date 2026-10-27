import { sk } from '@intra/shared/i18n';
import { UNSUBSCRIBE_REASONS } from '@intra/shared/schemas';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { useFragmentToken } from '@/lib/use-fragment-token';
import { cn } from '@/lib/utils';

const t = sk.unsubscribe;

export const Route = createFileRoute('/odhlasenie')({ component: UnsubscribePage });

/**
 * The page behind an e-mail's „Odhlásiť sa z odberu“ (`/odhlasenie#<token>`), public: the click
 * itself unsubscribes; a reason is optional, and a mistake can be undone here.
 */
function UnsubscribePage() {
  const token = useFragmentToken();
  const [reason, setReason] = useState<(typeof UNSUBSCRIBE_REASONS)[number] | null>(null);
  const [state, setState] = useState<'working' | 'done' | 'thanks' | 'undone' | 'invalid'>(
    'working',
  );
  const info = useMutation(trpc.unsubscribe.info.mutationOptions());
  const confirm = useMutation(trpc.unsubscribe.confirm.mutationOptions());
  const undo = useMutation(trpc.unsubscribe.undo.mutationOptions());

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    void (async () => {
      try {
        await info.mutateAsync({ token });
        await confirm.mutateAsync({ token });
        setState('done');
      } catch {
        setState('invalid');
      }
    })();
    // Once, for the token of this visit.
  }, [token]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f4f6f6] px-4 py-10">
      <div className="w-full max-w-[30rem] rounded-2xl bg-white p-7 shadow-raised">
        <div className="mb-5 flex items-center gap-2.5">
          <BrandMark className="size-8 bg-linear-160 from-[#18a5a7] to-[#0b7375]" />
          <span className="text-lg font-bold">{info.data?.brand ?? 'Alma'}</span>
        </div>
        {state === 'working' ? (
          <p role="status" className="text-sm text-muted">
            {t.working}
          </p>
        ) : state === 'invalid' ? (
          <p role="alert" className="text-sm text-danger">
            {t.invalid}
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-bold">{state === 'undone' ? t.undone : t.title}</h1>
              {state !== 'undone' ? (
                <p className="mt-2 text-sm text-muted">{t.text(info.data?.email ?? '')}</p>
              ) : null}
            </div>
            {state === 'done' ? (
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">{t.reason}</legend>
                {UNSUBSCRIBE_REASONS.map((value) => (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm',
                      reason === value ? 'border-primary bg-[#f0f8f7]' : 'border-border',
                    )}
                  >
                    <input
                      type="radio"
                      name="reason"
                      checked={reason === value}
                      onChange={() => setReason(value)}
                      className="accent-[#0f766e]"
                    />
                    {t.reasons[value]}
                  </label>
                ))}
                <Button
                  className="mt-2"
                  disabled={!reason || confirm.isPending}
                  onClick={() =>
                    reason &&
                    confirm.mutate({ token, reason }, { onSuccess: () => setState('thanks') })
                  }
                >
                  {t.send}
                </Button>
              </fieldset>
            ) : null}
            {state === 'thanks' ? (
              <p className="text-sm font-medium text-success">{t.thanks}</p>
            ) : null}
            {state !== 'undone' ? (
              <div className="border-t border-border-subtle pt-4 text-sm">
                <span className="text-muted">{t.undoQuestion} </span>
                <button
                  type="button"
                  className="font-semibold text-primary-text hover:underline"
                  disabled={undo.isPending}
                  onClick={() => undo.mutate({ token }, { onSuccess: () => setState('undone') })}
                >
                  {t.undo}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
