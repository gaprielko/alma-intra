import { sk } from '@intra/shared/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  BrandCardNote,
  BrandCardTitle,
  BrandLayout,
  brandCardClass,
} from '@/components/brand-panel';
import { EnrolStep, EnrolSteps } from '@/components/sign-in-steps';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { endSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { newPasswordForm, type PasswordForm } from '@/lib/new-password-form';
import { trpc } from '@/lib/trpc';
import { useFragmentToken } from '@/lib/use-fragment-token';

const t = sk.activate;
const acceptErrors = {
  WEAK_PASSWORD: sk.validation.weak_password,
  PASSWORD_BREACHED: sk.validation.password_breached,
};

export const Route = createFileRoute('/activate')({ component: ActivatePage });

/**
 * The page behind the invitation link (`/activate#<token>`): the password, then the phone and the
 * recovery codes. Two-step verification is mandatory, so the account is usable only after both.
 */
function ActivatePage() {
  const navigate = useNavigate();
  const token = useFragmentToken();
  const [challenge, setChallenge] = useState<string | null>(null);
  const check = useMutation(trpc.auth.checkInvitation.mutationOptions());
  const accept = useMutation(
    trpc.auth.acceptInvitation.mutationOptions({
      onSuccess: (result) => setChallenge(result.secondStep.challenge),
    }),
  );
  const form = useForm<PasswordForm>({
    resolver: zodResolver(newPasswordForm),
    defaultValues: { password: '', passwordAgain: '' },
  });

  const { mutate: checkInvitation } = check;
  useEffect(() => {
    if (token) checkInvitation({ token });
  }, [token, checkInvitation]);

  const enter = useCallback(async () => {
    endSession(); // drop whatever a previous user left in the cache
    await navigate({ to: '/' });
  }, [navigate]);
  // The password is set; a challenge that ran out is finished at the login.
  const toLogin = useCallback(() => void navigate({ to: '/login' }), [navigate]);

  if (challenge) {
    return (
      <BrandLayout>
        <EnrolStep challenge={challenge} onDone={enter} onRestart={toLogin} />
      </BrandLayout>
    );
  }

  // The link can also die while the form is open (expired, replaced by a newer invitation).
  const expiredMeanwhile = accept.error?.message === 'INVALID_OR_EXPIRED_TOKEN';
  if (!token || check.isError || expiredMeanwhile) {
    return (
      <BrandLayout>
        <section className={brandCardClass}>
          <BrandCardTitle title={t.invalid.title} text={t.invalid.body} />
        </section>
      </BrandLayout>
    );
  }

  if (!check.data) {
    return (
      <BrandLayout>
        <p className="text-sm text-muted" role="status">
          {t.checking}
        </p>
      </BrandLayout>
    );
  }

  const invitation = check.data;
  return (
    <BrandLayout>
      <Form {...form}>
        <form
          noValidate
          className={brandCardClass}
          onSubmit={(event) =>
            void form.handleSubmit((values) => accept.mutate({ token, password: values.password }))(
              event,
            )
          }
        >
          <EnrolSteps current={0} />
          <BrandCardTitle title={t.title} text={t.intro(invitation.email)} />

          {accept.isError ? (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {errorMessage(accept.error, acceptErrors, t.error)}
            </p>
          ) : null}

          {/* Lets password managers attach the new password to the right account. */}
          <input type="email" autoComplete="username" value={invitation.email} readOnly hidden />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="mt-6">
                <FormLabel>{t.password}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="passwordAgain"
            render={({ field }) => (
              <FormItem className="mt-4">
                <FormLabel>{t.passwordAgain}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className="mt-2 text-xs text-muted">{t.rules}</p>

          <Button type="submit" size="lg" className="mt-6 w-full" disabled={accept.isPending}>
            {accept.isPending ? t.submitting : t.submit}
          </Button>
        </form>
        <BrandCardNote>{t.note}</BrandCardNote>
      </Form>
    </BrandLayout>
  );
}
