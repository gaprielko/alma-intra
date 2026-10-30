import { sk } from '@intra/shared/i18n';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { useFragmentToken } from '@/lib/use-fragment-token';

const t = sk.interest;

export const Route = createFileRoute('/zaujem')({ component: InterestPage });

/**
 * The page behind an e-mail's „Mám vážny záujem“ (`/zaujem#<token>`), public. Opening it records
 * nothing, a mail scanner opens links too: only the button does (docs/activities.md, A-1).
 */
function InterestPage() {
  const token = useFragmentToken();
  const [state, setState] = useState<'working' | 'ask' | 'done' | 'again' | 'invalid'>('working');
  const info = useMutation(trpc.interest.info.mutationOptions());
  const confirm = useMutation(trpc.interest.confirm.mutationOptions());

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    info.mutate(
      { token },
      { onSuccess: () => setState('ask'), onError: () => setState('invalid') },
    );
    // Once, for the token of this visit.
  }, [token]);

  const email = info.data?.email ?? '';
  const product = info.data?.product ?? '';
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
        ) : state === 'ask' ? (
          <div>
            <h1 className="text-xl font-bold">{t.title(product)}</h1>
            <p className="mt-2 text-sm text-muted">{t.text(email)}</p>
            <Button
              className="mt-5 w-full"
              disabled={confirm.isPending}
              onClick={() =>
                confirm.mutate(
                  { token },
                  {
                    onSuccess: ({ repeated }) => setState(repeated ? 'again' : 'done'),
                    onError: () => setState('invalid'),
                  },
                )
              }
            >
              {t.confirm}
            </Button>
            <p className="mt-5 border-t border-border-subtle pt-4 text-[13px] text-muted">
              {t.dismiss}
            </p>
          </div>
        ) : (
          <div>
            <span
              aria-hidden
              className="inline-flex size-12 items-center justify-center rounded-full bg-success-soft text-success"
            >
              <Check className="size-6" />
            </span>
            <h1 className="mt-4 text-xl font-bold">
              {state === 'again' ? t.againTitle : t.doneTitle}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {state === 'again' ? t.againText(product) : t.doneText(product, email)}
            </p>
            {info.data?.contact ? (
              <p className="mt-5 border-t border-border-subtle pt-4 text-[13px] text-muted">
                {t.question}{' '}
                <a
                  href={`mailto:${info.data.contact}`}
                  className="font-semibold text-primary-text hover:underline"
                >
                  {info.data.contact}
                </a>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
