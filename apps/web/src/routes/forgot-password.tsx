import { sk } from '@intra/shared/i18n';
import { forgotPasswordSchema } from '@intra/shared/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
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
import { trpc } from '@/lib/trpc';

const t = sk.forgotPassword;
const toLoginClass = 'mt-6 inline-block text-sm font-medium text-primary-text hover:underline';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage });

/** The confirmation is the same whether or not the e-mail has an account — like the API's answer. */
function ForgotPasswordPage() {
  const form = useForm<z.input<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const request = useMutation(trpc.auth.requestPasswordReset.mutationOptions());

  if (request.isSuccess) {
    return (
      <BrandLayout>
        <section className={brandCardClass}>
          <BrandCardTitle title={t.sent.title} text={t.sent.body} />
          <Link to="/login" className={toLoginClass}>
            {t.toLogin}
          </Link>
        </section>
      </BrandLayout>
    );
  }

  return (
    <BrandLayout>
      <Form {...form}>
        <form
          // Our messages under the field (Zod), never the browser's bubble.
          noValidate
          className={brandCardClass}
          onSubmit={(event) => void form.handleSubmit((values) => request.mutate(values))(event)}
        >
          <BrandCardTitle title={t.title} text={t.intro} />

          {request.isError ? (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {errorMessage(request.error, {}, t.error)}
            </p>
          ) : null}

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="mt-6">
                <FormLabel>{t.email}</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="username" required {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" size="lg" className="mt-6 w-full" disabled={request.isPending}>
            {request.isPending ? t.submitting : t.submit}
          </Button>
          <div className="text-center">
            <Link to="/login" className={toLoginClass}>
              {t.toLogin}
            </Link>
          </div>
        </form>
      </Form>
    </BrandLayout>
  );
}
