import { sk } from '@intra/shared/i18n';
import { inviteUserSchema, type UserStatus } from '@intra/shared/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MoreHorizontal, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Avatar } from '@/components/avatar';
import { ErrorState } from '@/components/empty-state';
import { TableShell } from '@/components/table-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SegmentedChoice } from '@/components/ui/segmented';
import { TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { applyServerFieldErrors, refusedField } from '@/lib/form-errors';
import { formatDate, formatRecent } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useSession } from '@/lib/session';
import { trpc, type RouterOutputs } from '@/lib/trpc';
import { PhoneInput } from '@/components/phone-input';

const t = sk.users;
type Filter = 'all' | UserStatus;
const FILTERS: readonly Filter[] = ['all', 'active', 'invited', 'deactivated'];

export const Route = createFileRoute('/_app/settings/users')({
  validateSearch: z.object({ status: z.enum(['active', 'invited', 'deactivated']).optional() }),
  component: UsersPage,
});

type UserRow = RouterOutputs['user']['list']['items'][number];

const statusTone: Record<UserStatus, BadgeTone> = {
  active: 'success',
  invited: 'info',
  deactivated: 'neutral',
};

/** What is open over the list: a dialog or a confirmation, with the user it is about. */
type Open =
  | { kind: 'invite' }
  | {
      kind: 'edit' | 'deactivate' | 'reactivate' | 'withdraw' | 'resetSecondFactor';
      user: UserRow;
    };

function UsersPage() {
  const { status } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const filter: Filter = status ?? 'all';
  const me = useSession((s) => s.user?.id);
  const [open, setOpen] = useState<Open | null>(null);
  const list = useQuery({
    ...trpc.user.list.queryOptions(status ? { status } : {}),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5 px-7 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-[40rem] text-sm text-muted">{t.subtitle}</p>
        <Button onClick={() => setOpen({ kind: 'invite' })}>
          <UserPlus className="size-4" aria-hidden />
          {t.invite}
        </Button>
      </div>

      <SegmentedChoice
        label={t.columns.status}
        value={filter}
        onChange={(next) =>
          void navigate({ search: next === 'all' ? {} : { status: next }, replace: true })
        }
        options={FILTERS.map((key) => ({
          key,
          label: (
            <>
              {t.chips[key]}
              {list.data ? (
                <span className="ml-1.5 text-tertiary tabular-nums">{list.data.counts[key]}</span>
              ) : null}
            </>
          ),
        }))}
      />

      <TableShell
        columns={[
          t.columns.name,
          t.columns.email,
          t.columns.status,
          t.columns.secondFactor,
          t.columns.lastLogin,
          <span key="actions" className="sr-only">
            {sk.common.actions}
          </span>,
        ]}
        columnClassNames={[
          undefined,
          'hidden 2xl:table-cell',
          undefined,
          'hidden xl:table-cell',
          'hidden xl:table-cell',
          'w-14',
        ]}
        loading={list.isPending}
        refreshing={list.isPlaceholderData}
        message={
          loadFailed(list) ? (
            <ErrorState onRetry={() => void list.refetch()} />
          ) : list.data?.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t.empty}</p>
          ) : null
        }
      >
        {list.data?.items.map((user) => (
          <UserRowView
            key={user.id}
            user={user}
            isMe={user.id === me}
            onAction={(kind) => setOpen({ kind, user })}
          />
        ))}
      </TableShell>

      {open?.kind === 'invite' ? <PersonDialog onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'edit' ? (
        <PersonDialog user={open.user} onClose={() => setOpen(null)} />
      ) : null}
      {open && open.kind !== 'invite' && open.kind !== 'edit' ? (
        <UserConfirm kind={open.kind} user={open.user} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function UserRowView({
  user,
  isMe,
  onAction,
}: {
  user: UserRow;
  isMe: boolean;
  onAction: (kind: Exclude<Open['kind'], 'invite'>) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const resend = useMutation(
    trpc.user.resendInvitation.mutationOptions({
      onSuccess: async (answer) => {
        toast(answer.sent ? 'success' : 'info', answer.sent ? t.resent : t.alreadySending);
        await queryClient.invalidateQueries(trpc.user.list.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const delivery = user.invitationDelivery;
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar name={user.name} size={32} />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {user.name} {isMe ? <span className="font-normal text-muted">{t.you}</span> : null}
            </p>
            {user.position ? <p className="truncate text-xs text-muted">{user.position}</p> : null}
            {/* Its own column only on a wide window. */}
            <p className="truncate text-xs text-muted 2xl:hidden">{user.email}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden text-muted 2xl:table-cell">{user.email}</TableCell>
      <TableCell>
        <Badge tone={statusTone[user.status]} dot>
          {t.status[user.status]}
        </Badge>
        {user.status === 'invited' ? (
          <p className="mt-1 text-xs text-muted">
            {t.invitedOn(formatDate(user.invitedAt))}
            {delivery && delivery !== 'sent' ? (
              <span className={delivery === 'failed' ? 'text-danger' : undefined}>
                {' · '}
                {t.invitationDelivery[delivery]}
              </span>
            ) : null}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="hidden text-muted xl:table-cell">
        {user.secondFactor
          ? t.secondFactorOn
          : user.status === 'invited'
            ? t.secondFactorPending
            : t.secondFactorMissing}
      </TableCell>
      <TableCell className="hidden text-muted xl:table-cell">
        {user.lastLoginAt ? formatRecent(user.lastLoginAt) : sk.common.none}
      </TableCell>
      <TableCell className="text-right">
        {isMe ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" aria-label={t.actions.menu(user.name)}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onAction('edit')}>
                {t.actions.edit}
              </DropdownMenuItem>
              {user.status === 'invited' ? (
                <>
                  <DropdownMenuItem
                    disabled={resend.isPending}
                    onSelect={() => resend.mutate({ userId: user.id })}
                  >
                    {t.actions.resend}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => onAction('withdraw')}>
                    {t.actions.withdraw}
                  </DropdownMenuItem>
                </>
              ) : null}
              {user.status === 'active' ? (
                <>
                  <DropdownMenuItem onSelect={() => onAction('resetSecondFactor')}>
                    {t.actions.resetSecondFactor}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => onAction('deactivate')}>
                    {t.actions.deactivate}
                  </DropdownMenuItem>
                </>
              ) : null}
              {user.status === 'deactivated' ? (
                <DropdownMenuItem onSelect={() => onAction('reactivate')}>
                  {t.actions.reactivate}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

const personForm = inviteUserSchema;
type PersonForm = z.input<typeof personForm>;

/** „Pozvať používateľa“ without a user, „Upraviť údaje“ with one (the e-mail stays as it is). */
function PersonDialog({ user, onClose }: { user?: UserRow; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const d = user ? t.editDialog : t.inviteDialog;
  const form = useForm<PersonForm, unknown, z.output<typeof personForm>>({
    resolver: zodResolver(personForm),
    defaultValues: {
      email: user?.email ?? '',
      name: user?.name ?? '',
      phone: user?.phone ?? '',
      position: user?.position ?? '',
    },
  });
  const done = async (message: string) => {
    toast('success', message);
    await queryClient.invalidateQueries(trpc.user.list.pathFilter());
    onClose();
  };
  const onError = (error: unknown) => {
    const field = refusedField(error, { EMAIL_TAKEN: ['email', 'email_taken'] as const });
    if (field) form.setError(field[0], { type: 'server', message: field[1] });
    else {
      applyServerFieldErrors(error, form.setError);
      toast('error', errorMessage(error, t.errors));
    }
  };
  const invite = useMutation(
    trpc.user.invite.mutationOptions({
      onSuccess: (_, input) => done(t.inviteDialog.sent(input.email)),
      onError,
    }),
  );
  const update = useMutation(
    trpc.user.update.mutationOptions({ onSuccess: () => done(t.editDialog.saved), onError }),
  );
  const pending = invite.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) =>
              void form.handleSubmit(({ email, ...fields }) =>
                user
                  ? update.mutate({ userId: user.id, ...fields })
                  : invite.mutate({ email, ...fields }),
              )(event)
            }
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{d.name}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.inviteDialog.email}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" readOnly={!!user} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{d.phone}</FormLabel>
                    <FormControl>
                      <PhoneInput autoComplete="off" {...field} value={field.value ?? ''} />
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
                    <FormLabel>{d.position}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {user ? null : (
              <p className="rounded-xl bg-info-soft px-4 py-3 text-sm text-info">
                {t.inviteDialog.note}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {sk.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {user
                  ? pending
                    ? sk.common.saving
                    : sk.common.saveChanges
                  : pending
                    ? t.inviteDialog.submitting
                    : t.inviteDialog.submit}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmKind = 'deactivate' | 'reactivate' | 'withdraw' | 'resetSecondFactor';

/** The confirmation of an action of the row menu, and the action itself. */
function UserConfirm({
  kind,
  user,
  onClose,
}: {
  kind: ConfirmKind;
  user: UserRow;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const c = t.confirm[kind];
  const finish = async (message: string) => {
    toast('success', message);
    await queryClient.invalidateQueries(trpc.user.list.pathFilter());
    onClose();
  };
  const onError = (error: unknown) => {
    toast('error', errorMessage(error, t.errors));
    onClose();
  };
  const deactivate = useMutation(
    trpc.user.deactivate.mutationOptions({
      onSuccess: () => finish(t.confirm[kind === 'withdraw' ? 'withdraw' : 'deactivate'].done),
      onError,
    }),
  );
  const reactivate = useMutation(
    trpc.user.reactivate.mutationOptions({
      onSuccess: (answer) =>
        finish(answer.invitationSent ? t.confirm.reactivate.doneInvite : t.confirm.reactivate.done),
      onError,
    }),
  );
  const resetSecondFactor = useMutation(
    trpc.user.resetSecondFactor.mutationOptions({
      onSuccess: () => finish(t.confirm.resetSecondFactor.done),
      onError,
    }),
  );
  const input = { userId: user.id };
  const confirm = {
    deactivate: () => deactivate.mutate(input),
    withdraw: () => deactivate.mutate(input),
    reactivate: () => reactivate.mutate(input),
    resetSecondFactor: () => resetSecondFactor.mutate(input),
  }[kind];
  const title = typeof c.title === 'function' ? c.title(user.name) : c.title;
  // Somebody who never set a password gets a new invitation instead of her old access.
  const text =
    kind === 'reactivate' && !user.lastLoginAt
      ? `${t.confirm.reactivate.text} ${t.confirm.reactivate.textInvite}`
      : c.text;

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={title}
      description={text}
      confirmLabel={c.confirm}
      destructive={kind !== 'reactivate'}
      pending={deactivate.isPending || reactivate.isPending || resetSecondFactor.isPending}
      onConfirm={confirm}
    />
  );
}
