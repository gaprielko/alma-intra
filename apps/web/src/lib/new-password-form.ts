import { newPasswordSchema } from '@intra/shared/schemas';
import { z } from 'zod';

export const passwords = z.object({ password: z.string(), passwordAgain: z.string() });
export type PasswordForm = z.infer<typeof passwords>;

/** A new password, typed twice (activation, password reset); the messages are keys of `sk.validation`. */
export const newPasswordForm = passwords.superRefine((values, ctx) => {
  if (!newPasswordSchema.safeParse(values.password).success)
    ctx.addIssue({ code: 'custom', path: ['password'], message: 'weak_password' });
  if (values.passwordAgain !== values.password)
    ctx.addIssue({ code: 'custom', path: ['passwordAgain'], message: 'password_mismatch' });
});
