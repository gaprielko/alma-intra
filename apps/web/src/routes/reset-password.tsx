import { sk } from '@intra/shared/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { BrandCardTitle, BrandLayout, brandCardClass } from '@/components/brand-panel';
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
import { errorMessage } from '@/lib/errors';
import { applyServerFieldErrors } from '@/lib/form-errors';
import { newPasswordForm, type PasswordForm } from '@/lib/new-password-form';
import { trpc } from '@/lib/trpc';
import { useFragmentToken } from '@/lib/use-fragment-token';

const t = sk.resetPassword;
const resetErrors = {
  WEAK_PASSWORD: sk.validation.weak_password,
  PASSWORD_BREACHED: sk.validation.password_breached,
};
const primaryLinkClass =
  'mt-6 inline-flex h-12 w-full items-center justify-center rounded-[10px] bg-linear-to-b from-[#139698] to-[#0b6e70] px-5 font-semibold text-primary-foreground shadow-edge-button transition-transform duration-150 hover:from-[#179fa1] hover:to-[#0d7678] active:scale-[0.98]';

export const Route = createFileRoute('/reset-password')({ component: ResetPasswordPage });

/**
 * The page behind the link of the password reset e-mail (`/reset-password#<token>`). Nothing about
 * the account is shown before the password is set, so a dead link is only found out by the submit.
 * No session starts here: the new password is used at the login, with the second step.
 */
function ResetPasswordPage() {
  const token = useFragmentToken();
  const form = useForm<PasswordForm>({
    resolver: zodResolver(newPasswordForm),
    defaultValues: { password: '', passwordAgain: '' },
  });
  const reset = useMutation(
    trpc.auth.resetPassword.mutationOptions({
      onError: (error) => applyServerFieldErrors(error, form.setError),
    }),
  );

  if (reset.isSuccess) {
    return (
      <BrandLayout>
        <section className={brandCardClass}>
          <BrandCardTitle title={t.changed.title} text={t.changed.body} />
          <Link to="/login" className={primaryLinkClass}>
            {t.changed.toLogin}
          </Link>
        </section>
      </BrandLayout>
    );
  }

  if (!token || reset.error?.message === 'INVALID_OR_EXPIRED_TOKEN') {
    return (
      <BrandLayout>
        <section className={brandCardClass}>
          <BrandCardTitle title={t.invalid.title} text={t.invalid.body} />
          <Link to="/forgot-password" className={primaryLinkClass}>
            {t.invalid.action}
          </Link>
        </section>
      </BrandLayout>
    );
  }

  return (
    <BrandLayout>
      <Form {...form}>
        <form
          noValidate
          className={brandCardClass}
          onSubmit={(event) =>
            void form.handleSubmit((values) => reset.mutate({ token, password: values.password }))(
              event,
            )
          }
        >
          <BrandCardTitle title={t.title} text={t.intro} />

          {reset.isError ? (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {errorMessage(reset.error, resetErrors, t.error)}
            </p>
          ) : null}

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

          <Button type="submit" size="lg" className="mt-6 w-full" disabled={reset.isPending}>
            {reset.isPending ? t.submitting : t.submit}
          </Button>
        </form>
      </Form>
    </BrandLayout>
  );
}
