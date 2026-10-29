import { sk } from '@intra/shared/i18n';
import {
  ACCESS_TOKEN_DAYS,
  changePasswordSchema,
  updateProfileSchema,
} from '@intra/shared/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { KeyRound, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CodeBoxes, RecoveryCodes, TotpQr } from '@/components/second-factor';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input, readOnlyFieldClass, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { applyServerFieldErrors } from '@/lib/form-errors';
import { formatDate, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useSession } from '@/lib/session';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PhoneInput } from '@/components/phone-input';

const t = sk.account;
const tf = sk.secondFactor;

export const Route = createFileRoute('/_app/account')({ component: AccountPage });

/** Môj účet: her own profile and signature, her password and phone, the devices she is on. */
function AccountPage() {
  return (
    <div className="min-w-0">
      <PageHeader title={t.title} />
      <main className="grid items-start gap-5 p-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="min-w-0 space-y-5">
          <ProfileCard />
          <SignatureCard />
        </div>
        <div className="min-w-0 space-y-5">
          <SecurityCard />
          <SessionsCard />
          <ClaudeAccessCard />
        </div>
      </main>
    </div>
  );
}

function SectionCard({
  title,
  lead,
  action,
  children,
}: {
  title: string;
  lead: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="mt-1 text-sm text-muted">{lead}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

const profileForm = updateProfileSchema.omit({ emailSignature: true });
type ProfileForm = z.input<typeof profileForm>;

function useMe() {
  return useQuery(trpc.auth.me.queryOptions());
}

/** After a save: the profile query and the sidebar's name follow. */
function useProfileSaved() {
  const queryClient = useQueryClient();
  return async () => {
    const me = await queryClient.fetchQuery({ ...trpc.auth.me.queryOptions(), staleTime: 0 });
    useSession.getState().setSession(me);
  };
}

function ProfileCard() {
  const me = useMe();
  if (me.isPending) return <CardSkeleton />;
  if (loadFailed(me)) return <ErrorState onRetry={() => void me.refetch()} />;
  return <ProfileForm me={me.data} />;
}

function ProfileForm({
  me,
}: {
  me: {
    name: string;
    titleBefore: string | null;
    titleAfter: string | null;
    email: string;
    phone: string | null;
    position: string | null;
    emailSignature: string | null;
  };
}) {
  const toast = useToast();
  const saved = useProfileSaved();
  const form = useForm<ProfileForm, unknown, z.output<typeof profileForm>>({
    resolver: zodResolver(profileForm),
    defaultValues: {
      name: me.name,
      titleBefore: me.titleBefore ?? '',
      titleAfter: me.titleAfter ?? '',
      phone: me.phone ?? '',
      position: me.position ?? '',
    },
  });
  const update = useMutation(
    trpc.account.updateProfile.mutationOptions({
      onSuccess: async (_, input) => {
        toast('success', t.profile.saved);
        form.reset({
          name: input.name,
          titleBefore: input.titleBefore ?? '',
          titleAfter: input.titleAfter ?? '',
          phone: input.phone ?? '',
          position: input.position ?? '',
        });
        await saved();
      },
      onError: (error) => {
        applyServerFieldErrors(error, form.setError);
        toast('error', errorMessage(error));
      },
    }),
  );
  return (
    <SectionCard title={t.profile.title} lead={t.profile.lead}>
      <Form {...form}>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) =>
            void form.handleSubmit((values) =>
              update.mutate({ ...values, emailSignature: me.emailSignature ?? '' }),
            )(event)
          }
        >
          <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)_8rem]">
            <FormField
              control={form.control}
              name="titleBefore"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.profile.titleBefore}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.profile.name}</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="titleAfter"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.profile.titleAfter}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-email">{t.profile.email}</Label>
              <Input id="account-email" readOnly value={me.email} className={readOnlyFieldClass} />
            </div>
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.profile.phone}</FormLabel>
                  <FormControl>
                    <PhoneInput autoComplete="tel" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="position"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.profile.position}</FormLabel>
                  <FormControl>
                    <Input autoComplete="organization-title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
              {update.isPending ? sk.common.saving : sk.common.saveChanges}
            </Button>
          </div>
        </form>
      </Form>
    </SectionCard>
  );
}

function SignatureCard() {
  const me = useMe();
  const toast = useToast();
  const saved = useProfileSaved();
  const [draft, setDraft] = useState<string | null>(null);
  const update = useMutation(
    trpc.account.updateProfile.mutationOptions({
      onSuccess: async () => {
        toast('success', t.signature.saved);
        setDraft(null);
        await saved();
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  if (!me.data) return null;
  const data = me.data;
  const signature = data.emailSignature ?? '';
  return (
    <SectionCard
      title={t.signature.title}
      lead={t.signature.lead}
      action={
        draft === null ? (
          <Button variant="secondary" size="sm" onClick={() => setDraft(signature)}>
            {t.signature.edit}
          </Button>
        ) : null
      }
    >
      {draft === null ? (
        signature ? (
          <p className="rounded-xl bg-surface px-4 py-3 text-sm whitespace-pre-line">{signature}</p>
        ) : (
          <p className="text-sm text-muted">{t.signature.empty}</p>
        )
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({
              name: data.name,
              phone: data.phone ?? '',
              position: data.position ?? '',
              emailSignature: draft,
            });
          }}
        >
          <Label htmlFor="signature" className="sr-only">
            {t.signature.field}
          </Label>
          <Textarea
            id="signature"
            rows={5}
            maxLength={1000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              {sk.common.cancel}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? sk.common.saving : sk.common.save}
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}

function SecurityRow({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle py-4 first:border-t-0 first:pt-0 last:pb-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-text [&_svg]:size-4">
        {icon}
      </span>
      <div className="mr-auto min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

type SecurityDialog = 'password' | 'phone' | 'recovery';

function SecurityCard() {
  const status = useQuery(trpc.account.secondFactorStatus.queryOptions());
  const [open, setOpen] = useState<SecurityDialog | null>(null);
  const close = () => setOpen(null);
  return (
    <SectionCard title={t.security.title} lead={t.security.lead}>
      <SecurityRow
        icon={<KeyRound aria-hidden />}
        title={t.security.password}
        detail={t.security.passwordNever}
      >
        <Button variant="secondary" size="sm" onClick={() => setOpen('password')}>
          {t.security.changePassword}
        </Button>
      </SecurityRow>
      <SecurityRow
        icon={<ShieldCheck aria-hidden />}
        title={t.security.secondFactor}
        detail={
          status.data ? (
            <>
              <span className="font-medium text-success">{t.security.secondFactorOn}</span>
              {' · '}
              {t.security.secondFactorDetail(status.data.recoveryCodesLeft)}
            </>
          ) : (
            sk.common.loading
          )
        }
      >
        <Button variant="secondary" size="sm" onClick={() => setOpen('phone')}>
          <Smartphone className="size-3.5" aria-hidden />
          {t.security.newPhone}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen('recovery')}>
          {t.security.newRecoveryCodes}
        </Button>
      </SecurityRow>
      {open === 'password' ? <ChangePasswordDialog onClose={close} /> : null}
      {open === 'phone' ? <NewPhoneDialog onClose={close} /> : null}
      {open === 'recovery' ? <NewRecoveryCodesDialog onClose={close} /> : null}
    </SectionCard>
  );
}

type PasswordForm = z.input<typeof changePasswordSchema>;

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const d = t.changePasswordDialog;
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<PasswordForm, unknown, z.output<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', repeatPassword: '' },
  });
  const change = useMutation(
    trpc.account.changePassword.mutationOptions({
      onSuccess: async () => {
        toast('success', d.done);
        await queryClient.invalidateQueries(trpc.account.sessions.pathFilter());
        onClose();
      },
      onError: (error) => {
        const reason = errorMessage(error, { WRONG_PASSWORD: 'x', PASSWORD_BREACHED: 'y' }, '');
        if (reason === 'x')
          form.setError('currentPassword', { type: 'server', message: 'wrong_password' });
        else if (reason === 'y')
          form.setError('newPassword', { type: 'server', message: 'password_breached' });
        else {
          applyServerFieldErrors(error, form.setError);
          toast('error', errorMessage(error));
        }
      },
    }),
  );
  const field = (name: keyof PasswordForm, label: string, autoComplete: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: input }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type="password" autoComplete={autoComplete} {...input} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => void form.handleSubmit((values) => change.mutate(values))(event)}
          >
            {field('currentPassword', d.current, 'current-password')}
            {field('newPassword', d.new, 'new-password')}
            {field('repeatPassword', d.repeat, 'new-password')}
            <p className="text-xs text-muted">{d.rules}</p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {sk.common.cancel}
              </Button>
              <Button type="submit" disabled={change.isPending}>
                {change.isPending ? sk.common.saving : d.submit}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const alertClass = 'rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger';

/**
 * The phone moves in three steps: her password and a code of the phone in force (or a recovery
 * code), then the QR code and a code of the new phone, then the new recovery codes.
 */
function NewPhoneDialog({ onClose }: { onClose: () => void }) {
  const d = t.newPhoneDialog;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const setup = useMutation(trpc.account.secondFactorSetup.mutationOptions());
  const confirm = useMutation(
    trpc.account.secondFactorConfirm.mutationOptions({
      onSuccess: async (answer) => {
        setRecoveryCodes(answer.recoveryCodes);
        await queryClient.invalidateQueries(trpc.account.pathFilter());
      },
    }),
  );
  const finish = () => {
    toast('success', d.done);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !recoveryCodes && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{recoveryCodes ? tf.recovery.title : d.title}</DialogTitle>
          {setup.data ? null : <DialogDescription>{d.intro}</DialogDescription>}
        </DialogHeader>
        {recoveryCodes ? (
          <RecoveryCodes codes={recoveryCodes} onDone={finish} />
        ) : setup.data ? (
          <form
            noValidate
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              confirm.mutate({ code: newCode });
            }}
          >
            <TotpQr uri={setup.data.otpauthUri} secret={setup.data.secret} />
            {confirm.isError ? (
              <p role="alert" className={alertClass}>
                {errorMessage(confirm.error, tf.errors, tf.errors.generic)}
              </p>
            ) : null}
            <fieldset className="max-w-[22rem]">
              <legend className="mb-2 text-sm font-medium">{tf.code}</legend>
              <CodeBoxes
                value={newCode}
                onChange={setNewCode}
                invalid={confirm.isError}
                autoFocus
                labelOf={sk.auth.secondStep.digit}
              />
            </fieldset>
            <p className="text-xs text-muted">{d.note}</p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {sk.common.cancel}
              </Button>
              <Button type="submit" disabled={confirm.isPending || newCode.length !== 6}>
                {confirm.isPending ? tf.confirming : tf.confirm}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setup.mutate({ password, code: currentCode });
            }}
          >
            {setup.isError ? (
              <p role="alert" className={alertClass}>
                {errorMessage(setup.error, tf.errors, tf.errors.generic)}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="new-phone-password">{d.password}</Label>
              <Input
                id="new-phone-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-phone-code">{d.currentCode}</Label>
              <Input
                id="new-phone-code"
                className="font-mono"
                autoComplete="one-time-code"
                maxLength={20}
                value={currentCode}
                onChange={(event) => setCurrentCode(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {sk.common.cancel}
              </Button>
              <Button
                type="submit"
                disabled={setup.isPending || !password || currentCode.trim().length < 6}
              >
                {setup.isPending ? tf.confirming : sk.common.continue}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewRecoveryCodesDialog({ onClose }: { onClose: () => void }) {
  const d = t.recoveryDialog;
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const create = useMutation(
    trpc.account.newRecoveryCodes.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.account.secondFactorStatus.pathFilter()),
    }),
  );
  return (
    <Dialog open onOpenChange={(next) => !next && !create.data && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{create.data ? tf.recovery.title : d.title}</DialogTitle>
          {create.data ? null : <DialogDescription>{d.intro}</DialogDescription>}
        </DialogHeader>
        {create.data ? (
          <RecoveryCodes codes={create.data.recoveryCodes} onDone={onClose} />
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate({ password });
            }}
          >
            {create.isError ? (
              <p role="alert" className={alertClass}>
                {errorMessage(create.error, tf.errors, tf.errors.generic)}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="recovery-password">{d.password}</Label>
              <Input
                id="recovery-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {sk.common.cancel}
              </Button>
              <Button type="submit" disabled={create.isPending || !password}>
                {d.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** „Chrome · Windows“ from a user agent; the full string is never shown. */
export function browserOf(userAgent: string | null): string {
  if (!userAgent) return t.sessions.unknownBrowser;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Android/.test(userAgent)
          ? 'Android'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (!browser) return t.sessions.unknownBrowser;
  return system ? `${browser} · ${system}` : browser;
}

function SessionsCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const sessions = useQuery(trpc.account.sessions.queryOptions());
  const refresh = () => queryClient.invalidateQueries(trpc.account.sessions.pathFilter());
  const end = useMutation(
    trpc.account.endSession.mutationOptions({
      onSuccess: async () => {
        toast('success', t.sessions.ended);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  const endOthers = useMutation(
    trpc.account.endOtherSessions.mutationOptions({
      onSuccess: async () => {
        toast('success', t.sessions.endedOthers);
        await refresh();
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;
  return (
    <SectionCard
      title={t.sessions.title}
      lead={t.sessions.lead}
      action={
        others > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={endOthers.isPending}
            onClick={() => endOthers.mutate()}
          >
            {t.sessions.endOthers}
          </Button>
        ) : null
      }
    >
      {sessions.isPending ? (
        <p className="text-sm text-muted">{sk.common.loading}</p>
      ) : loadFailed(sessions) ? (
        <ErrorState onRetry={() => void sessions.refetch()} />
      ) : (
        <ul>
          {sessions.data.map((session) => (
            <li
              key={session.sessionId}
              className="flex items-center gap-3 border-t border-border-subtle py-3 first:border-t-0 first:pt-0 last:pb-0"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                <Monitor className="size-4" aria-hidden />
              </span>
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-medium">
                  {browserOf(session.userAgent)}
                  {session.current ? (
                    <span className="font-normal text-muted"> · {t.sessions.thisDevice}</span>
                  ) : null}
                </p>
                <p className={cn('text-xs', session.current ? 'text-success' : 'text-muted')}>
                  {session.current
                    ? t.sessions.activeNow
                    : t.sessions.lastActive(formatRecent(session.lastActiveAt))}
                </p>
              </div>
              {session.current ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={end.isPending}
                  onClick={() => end.mutate({ sessionId: session.sessionId })}
                >
                  {t.sessions.end}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * „Prístup pre Claude“: the MCP address, and her personal access tokens for Claude Code (made,
 * shown once, revoked); claude.ai and Claude Desktop sign in through the connector instead.
 */
function ClaudeAccessCard() {
  const c = t.claude;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const tokens = useQuery(trpc.account.accessTokens.queryOptions());
  const revoke = useMutation(
    trpc.account.revokeAccessToken.mutationOptions({
      onSuccess: async () => {
        toast('success', c.revokedDone);
        await queryClient.invalidateQueries(trpc.account.accessTokens.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  const connections = useQuery(trpc.oauth.connections.queryOptions());
  const disconnect = useMutation(
    trpc.oauth.revokeConnection.mutationOptions({
      onSuccess: async () => {
        toast('success', c.disconnected);
        await queryClient.invalidateQueries(trpc.oauth.connections.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  const address = `${window.location.origin}/mcp`;
  const now = Date.now();
  return (
    <SectionCard
      title={c.title}
      lead={c.lead}
      action={
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          <KeyRound className="size-4" aria-hidden />
          {c.newToken}
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="mcp-address">{c.address}</Label>
          <CopyField id="mcp-address" value={address} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{c.connections}</p>
          {(connections.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">{c.noConnections}</p>
          ) : (
            <ul>
              {connections.data!.map((connection) => (
                <li
                  key={connection.id}
                  className="flex items-center gap-3 border-t border-border-subtle py-3 first:border-t-0 first:pt-0 last:pb-0"
                >
                  <div className="mr-auto min-w-0">
                    <p className="truncate text-sm font-medium">
                      {connection.clientName ?? sk.oauth.unnamed}
                    </p>
                    <p className="text-xs text-muted">
                      {[
                        c.connected(formatDate(connection.createdAt)),
                        connection.lastUsedAt
                          ? c.lastUsed(formatRecent(connection.lastUsedAt))
                          : c.neverUsed,
                      ].join(' · ')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disconnect.isPending}
                    onClick={() => disconnect.mutate({ id: connection.id })}
                  >
                    {c.disconnect}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{c.tokens}</p>
          {tokens.isPending ? (
            <p className="text-sm text-muted">{sk.common.loading}</p>
          ) : loadFailed(tokens) ? (
            <ErrorState onRetry={() => void tokens.refetch()} />
          ) : tokens.data.length === 0 ? (
            <p className="text-sm text-muted">{c.noTokens}</p>
          ) : (
            <ul>
              {tokens.data.map((token) => {
                const dead = token.revokedAt
                  ? c.revoked
                  : new Date(token.expiresAt).getTime() < now
                    ? c.expired
                    : null;
                return (
                  <li
                    key={token.id}
                    className="flex items-center gap-3 border-t border-border-subtle py-3 first:border-t-0 first:pt-0 last:pb-0"
                  >
                    <div className="mr-auto min-w-0">
                      <p className={cn('truncate text-sm font-medium', dead && 'text-muted')}>
                        {token.name}
                      </p>
                      <p className="text-xs text-muted">
                        {[
                          dead ?? c.expires(formatDate(token.expiresAt)),
                          token.lastUsedAt
                            ? c.lastUsed(formatRecent(token.lastUsedAt))
                            : c.neverUsed,
                        ].join(' · ')}
                      </p>
                    </div>
                    {dead ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate({ id: token.id })}
                      >
                        {c.revoke}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {creating ? (
        <NewAccessTokenDialog address={address} onClose={() => setCreating(false)} />
      ) : null}
    </SectionCard>
  );
}

/** A value to copy as it is: read-only, with a button. */
function CopyField({
  id,
  value,
  multiline = false,
}: {
  id: string;
  value: string;
  multiline?: boolean;
}) {
  const toast = useToast();
  const copy = () =>
    void navigator.clipboard.writeText(value).then(
      () => toast('success', t.claude.copied),
      () => undefined,
    );
  return (
    <div className="mt-1.5 flex gap-2">
      {multiline ? (
        <Textarea
          id={id}
          readOnly
          rows={3}
          value={value}
          className={cn(readOnlyFieldClass, 'font-mono text-xs')}
        />
      ) : (
        <Input
          id={id}
          readOnly
          value={value}
          className={cn(readOnlyFieldClass, 'font-mono text-sm')}
        />
      )}
      <Button variant="secondary" className="shrink-0" onClick={copy}>
        {t.claude.copy}
      </Button>
    </div>
  );
}

type TokenDays = (typeof ACCESS_TOKEN_DAYS)[number];

function NewAccessTokenDialog({ address, onClose }: { address: string; onClose: () => void }) {
  const d = t.claude.dialog;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [days, setDays] = useState<TokenDays>(90);
  const create = useMutation(
    trpc.account.createAccessToken.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.account.accessTokens.pathFilter()),
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  const token = create.data?.token;
  const command = `claude mcp add --transport http alma-intra ${address} --header "Authorization: Bearer ${token ?? ''}"`;
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          {token ? <DialogDescription>{d.shownOnce}</DialogDescription> : null}
        </DialogHeader>
        {token ? (
          <div className="space-y-4">
            <CopyField id="new-token" value={token} />
            <div>
              <Label htmlFor="claude-command">{d.command}</Label>
              <CopyField id="claude-command" multiline value={command} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="token-name">{d.name}</Label>
              <Input
                id="token-name"
                className="mt-1.5"
                maxLength={60}
                placeholder={d.namePlaceholder}
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="token-days">{d.days}</Label>
              <Select
                id="token-days"
                value={String(days)}
                onChange={(value) => setDays(Number(value) as TokenDays)}
              >
                {ACCESS_TOKEN_DAYS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {d.daysOption(option)}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          {token ? (
            <Button onClick={onClose}>{d.done}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {sk.common.cancel}
              </Button>
              <Button
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate({ name: name.trim(), days })}
              >
                {d.create}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
