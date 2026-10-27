import { sk } from '@intra/shared/i18n';
import { emailSchema } from '@intra/shared/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BrandCardTitle, BrandLayout, brandCardClass } from '@/components/brand-panel';
import { EnrolStep, type SecondStep, VerifyStep } from '@/components/sign-in-steps';
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
import { endSession, restoreSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { trpc } from '@/lib/trpc';

const t = sk.auth;
/**
 * Both fields are required and the e-mail must look like one; nothing is said about the password's
 * shape: the rules for new passwords do not apply to one that already exists, the server decides.
 */
const loginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
const loginErrors = {
  UNAUTHORIZED: t.invalidCredentials,
  // A password the server's input schema refuses cannot be the right one either.
  BAD_REQUEST: t.invalidCredentials,
  TOO_MANY_REQUESTS: t.tooManyAttempts,
  USER_DEACTIVATED: t.deactivated,
  FORBIDDEN: t.genericError,
};
const infoClass = 'mt-5 rounded-xl bg-info-soft px-4 py-3 text-sm text-info';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ reason: z.enum(['inactive']).optional() }),
  // Somebody already signed in (a bookmark, a second tab) goes home, not to a form she does not
  // need. Not right after the app signed her out with a reason: that ended the session.
  beforeLoad: async ({ search }) => {
    if (!search.reason && (await restoreSession({ quick: true }))) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
      throw redirect({ to: '/' });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { reason } = Route.useSearch();
  const [secondStep, setSecondStep] = useState<SecondStep | null>(null);
  const [expired, setExpired] = useState(false);
  const form = useForm<z.input<typeof loginFormSchema>, unknown, z.output<typeof loginFormSchema>>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });
  /** The session is in the cookies now. */
  const enter = async () => {
    endSession(); // drop whatever the previous user left in the cache
    await navigate({ to: '/' });
  };
  const login = useMutation(
    trpc.auth.login.mutationOptions({
      onSuccess: async (answer) => {
        if (answer.secondStep) {
          setExpired(false);
          setSecondStep(answer.secondStep);
          return;
        }
        await enter();
      },
    }),
  );
  const { reset: resetLogin } = login;
  const restart = useCallback(
    (becauseExpired: boolean) => {
      setSecondStep(null);
      setExpired(becauseExpired);
      form.setValue('password', '');
      resetLogin();
    },
    [form, resetLogin],
  );

  if (secondStep) {
    return (
      <BrandLayout>
        {secondStep.kind === 'verify' ? (
          <VerifyStep challenge={secondStep.challenge} onDone={enter} onRestart={restart} />
        ) : (
          <EnrolStep challenge={secondStep.challenge} onDone={enter} onRestart={restart} />
        )}
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
          onSubmit={(event) => void form.handleSubmit((values) => login.mutate(values))(event)}
        >
          <BrandCardTitle title={t.title} text={t.subtitle} />

          {expired && !login.isError ? <p className={infoClass}>{t.secondStep.expired}</p> : null}
          {reason && !login.isError && !expired ? (
            <p className={infoClass}>{t.loggedOutInactive}</p>
          ) : null}
          {login.isError ? (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {errorMessage(login.error, loginErrors, t.genericError)}
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="mt-4">
                <FormLabel>{t.password}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="current-password" required {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="mt-4 flex justify-end text-sm">
            <Link to="/forgot-password" className="font-medium text-primary-text hover:underline">
              {t.forgotPassword}
            </Link>
          </div>

          <Button type="submit" size="lg" className="mt-6 w-full" disabled={login.isPending}>
            {login.isPending ? t.loggingIn : t.login}
          </Button>
        </form>
      </Form>
    </BrandLayout>
  );
}
