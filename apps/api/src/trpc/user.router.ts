import {
  inviteUserSchema,
  updateUserSchema,
  userIdSchema,
  userListSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { hit, RATE_LIMITS } from '../security/rate-limit.js';
import * as users from '../users/users.service.js';
import type { Context } from './context.js';
import { authorizedProcedure, router, targetUser } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof users.UserError)) throw error;
    const code =
      error.code === 'NOT_FOUND' ? 'NOT_FOUND' : error.code === 'EMAIL_TAKEN' ? 'CONFLICT' : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

/** Every event here is about the user the call names. */
const auditTarget = (ctx: Context, userId: string) =>
  ctx.audit.set({ entityType: 'user', entityId: userId });

/**
 * Settings › Používatelia. One role for now: every active user manages the others (`can()`), but
 * nobody deactivates herself or resets her own second factor, and the last active user stays.
 */
export const userRouter = router({
  list: authorizedProcedure('user.read')
    .input(userListSchema)
    .query(({ ctx, input }) => users.listUsers(ctx.db, input)),

  /** A new colleague: an `invited` account and an invitation e-mail with a link for 72 hours. */
  invite: authorizedProcedure('user.invite')
    .input(inviteUserSchema)
    .mutation(async ({ ctx, input }) => {
      const rule = RATE_LIMITS.invitationPerUser;
      if ((await hit(ctx.db, rule, ctx.session.userId)).count > rule.limit) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      const created = await run(() => users.inviteUser(ctx.db, ctx.session.userId, input));
      auditTarget(ctx, created.id);
      ctx.audit.set({ diff: { status: 'invited' } });
      return created;
    }),

  update: authorizedProcedure('user.update', targetUser)
    .input(updateUserSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => users.updateUser(ctx.db, input));
      auditTarget(ctx, input.userId);
      return { ok: true as const };
    }),

  deactivate: authorizedProcedure('user.deactivate', targetUser)
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { from } = await run(() => users.deactivateUser(ctx.db, input.userId));
      auditTarget(ctx, input.userId);
      ctx.audit.set({ diff: { status: { before: from, after: 'deactivated' } } });
      return { ok: true as const };
    }),

  reactivate: authorizedProcedure('user.reactivate', targetUser)
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await run(() => users.reactivateUser(ctx.db, input.userId));
      auditTarget(ctx, input.userId);
      ctx.audit.set({
        diff: {
          status: { before: 'deactivated', after: result.to },
          invitationResent: result.invitationSent,
        },
      });
      return result;
    }),

  /** „Poslať znova“. `sent: false` while the previous invitation is still on its way. */
  resendInvitation: authorizedProcedure('user.invite', targetUser)
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      const sent = await run(() => users.resendInvitation(ctx.db, input.userId));
      auditTarget(ctx, input.userId);
      ctx.audit.set({ diff: { invitationResent: sent } });
      return { sent };
    }),

  /** For somebody who lost her phone; she sets up a new one at her next login. */
  resetSecondFactor: authorizedProcedure('user.reset_second_factor', targetUser)
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { removed } = await run(() => users.resetUserSecondFactor(ctx.db, input.userId));
      auditTarget(ctx, input.userId);
      ctx.audit.set({ diff: { secondFactorReset: removed } });
      return { removed };
    }),
});
