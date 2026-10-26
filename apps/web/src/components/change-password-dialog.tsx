import { sk } from '@intra/shared/i18n';
import { type ChangePasswordInput, changePasswordSchema } from '@intra/shared/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { fieldError } from '@/components/settings-card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogIcon,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.settings.account;

/**
 * S7: how strong a password is, in four steps: the rule's length and digit, then more length, a
 * letter of each case and something that is neither. Three steps make it strong enough to say so.
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length === 0) return 0;
  let score = 0;
  if (password.length >= 10 && /\d/.test(password)) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.max(1, score) as 1 | 2 | 3 | 4;
}

const STRENGTH_TEXT = { weak: [1], fair: [2], strong: [3, 4] } as const;

function strengthLabel(score: number): string {
  if (STRENGTH_TEXT.strong.includes(score as 3 | 4)) return t.passwordDialog.strength.strong;
  if (score === 2) return t.passwordDialog.strength.fair;
  return t.passwordDialog.strength.weak;
}

/**
 * HS-N1f „Zmeniť heslo" (ALMA-275, S7): the W8 dialog with the three fields, the strength meter
 * under the new password and the note that the other devices sign out. Saved through the same
 * procedure as before; a success closes it with a toast.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const email = useSession((s) => s.user?.email ?? '');
  const toast = useToast();
  const changePassword = useMutation(trpc.account.changePassword.mutationOptions());
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', repeatPassword: '' },
  });
  const { errors } = form.formState;
  // Every opening starts empty, and nothing typed outlives a close.
  useEffect(() => {
    form.reset();
  }, [open, form]);
  const newPassword = form.watch('newPassword');
  const score = passwordStrength(newPassword);

  const save = form.handleSubmit(async (values) => {
    try {
      await changePassword.mutateAsync(values);
      toast('success', t.passwordChanged);
      onOpenChange(false);
    } catch (error) {
      toast('error', errorMessage(error, sk.settings.errors, sk.settings.errors.generic));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form noValidate onSubmit={(event) => void save(event)} className="contents">
          <DialogHeader>
            <DialogIcon icon={Lock} />
            <DialogTitle>{t.passwordDialog.title}</DialogTitle>
            <DialogDescription>{t.passwordDialog.rule}</DialogDescription>
          </DialogHeader>
          {/* The account's e-mail, for the password manager that saves the new password with it. */}
          <input
            type="email"
            autoComplete="username"
            value={email}
            readOnly
            tabIndex={-1}
            aria-hidden
            className="sr-only"
          />
          <fieldset disabled={changePassword.isPending} className="flex flex-col gap-4">
            {(['currentPassword', 'newPassword', 'repeatPassword'] as const).map((field) => (
              <div key={field}>
                <Label htmlFor={`password-${field}`}>{t[field]}</Label>
                <Input
                  id={`password-${field}`}
                  type="password"
                  autoFocus={field === 'currentPassword'}
                  autoComplete={field === 'currentPassword' ? 'current-password' : 'new-password'}
                  aria-invalid={Boolean(errors[field])}
                  aria-describedby={
                    [
                      errors[field] ? `password-${field}-error` : null,
                      field === 'newPassword' ? 'password-strength' : null,
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  {...form.register(field)}
                />
                {errors[field]
                  ? fieldError(
                      field === 'newPassword'
                        ? 'weak_password'
                        : field === 'repeatPassword'
                          ? 'password_mismatch'
                          : 'required',
                      `password-${field}-error`,
                    )
                  : null}
                {field === 'newPassword' ? (
                  <div id="password-strength" className="mt-2" aria-live="polite">
                    <div className="flex gap-1.5" aria-hidden>
                      {[1, 2, 3, 4].map((step) => (
                        <span
                          key={step}
                          className={cn(
                            'h-1 flex-1 rounded-full transition-colors',
                            step <= score
                              ? score >= 3
                                ? 'bg-success'
                                : score === 2
                                  ? 'bg-warning'
                                  : 'bg-danger'
                              : 'bg-track',
                          )}
                        />
                      ))}
                    </div>
                    {newPassword ? (
                      <p
                        className={cn(
                          'mt-1 text-[11.5px] font-medium',
                          score >= 3
                            ? 'text-success'
                            : score === 2
                              ? 'text-[#8a4408]'
                              : 'text-danger',
                        )}
                      >
                        {strengthLabel(score)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </fieldset>
          <DialogFooter className="items-center justify-between">
            <p className="text-xs text-tertiary">{t.passwordDialog.footnote}</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {sk.common.cancel}
              </Button>
              <Button type="submit" disabled={changePassword.isPending}>
                {changePassword.isPending ? sk.settings.saving : t.changePassword}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
