import {
  accessTokenIdSchema,
  accountRecoveryCodesSchema,
  accountSecondFactorConfirmSchema,
  accountSecondFactorSetupSchema,
  changePasswordSchema,
  createAccessTokenSchema,
  endSessionSchema,
  importAddressesSchema,
  updateProfileSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as account from '../auth/account.service.js';
import * as auth from '../auth/auth.service.js';
import * as secondFactor from '../auth/second-factor.service.js';
import { enqueueMail } from '../mail/mail-outbox.js';
import { createAccessToken, listAccessTokens, revokeAccessToken } from '../mcp/access-tokens.js';
import { hit, RATE_LIMITS, refund } from '../security/rate-limit.js';
import type { Context } from './context.js';
import { countCodeAttempt } from './second-factor-attempt.js';
import { protectedProcedure, router } from './trpc.js';

type SessionContext = Context & { session: NonNullable<Context['session']> };

const tooMany = () => new TRPCError({ code: 'TOO_MANY_REQUESTS' });

/** Her own account is the entity of every event here: the user, never what she typed. */
const auditSelf = (ctx: SessionContext) =>
  ctx.audit.set({ userId: ctx.session.userId, entityType: 'user', entityId: ctx.session.userId });

/**
 * Her current password before something about her login changes, counted per user: a stolen
 * session must not guess the password it would need for that.
 */
async function confirmPassword(ctx: SessionContext, password: string) {
  const userId = ctx.session.userId;
  const counted = await hit(ctx.db, RATE_LIMITS.passwordChangePerUser, userId);
  if (counted.count > RATE_LIMITS.passwordChangePerUser.limit) {
    ctx.audit.set(
      counted.count === RATE_LIMITS.passwordChangePerUser.limit + 1
        ? { diff: { reasonCode: 'rate_limited' } }
        : { skipFailureAudit: true },
    );
    throw tooMany();
  }
  if (!(await account.isCurrentPassword(ctx.db, userId, password))) {
    ctx.audit.set({ diff: { reasonCode: 'wrong_password' } });
    throw new TRPCError({ code: 'FORBIDDEN', message: 'WRONG_PASSWORD' });
  }
  await refund(ctx.db, RATE_LIMITS.passwordChangePerUser, userId, counted);
}

/**
 * „Môj účet“: every user's own account. The procedures take no user id and act on the session's
 * user only, so there is no other account a caller could name. The events name the user; never a
 * name, a password, a code or a secret.
 */
export const accountRouter = router({
  setImportAddresses: protectedProcedure
    .input(importAddressesSchema)
    .mutation(async ({ ctx, input }) => {
      await account.setImportAddresses(ctx.db, ctx.session.userId, input.addresses);
      auditSelf(ctx);
      ctx.audit.set({ diff: { fields: ['importAddresses'] } });
      return { ok: true as const };
    }),

  updateProfile: protectedProcedure.input(updateProfileSchema).mutation(async ({ ctx, input }) => {
    const fields = await account.updateProfile(ctx.db, ctx.session.userId, input);
    auditSelf(ctx);
    ctx.audit.set({ diff: { fields } });
    return { ok: true as const };
  }),

  /**
   * The current password, then the new one; this session stays, the others end. Wrong current
   * passwords are counted per user and leave a `.failed` event. A new password known from a breach
   * is refused.
   */
  changePassword: protectedProcedure
    .meta({ auditFailure: true })
    .input(changePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.userId;
      auditSelf(ctx);
      const counted = await hit(ctx.db, RATE_LIMITS.passwordChangePerUser, userId);
      if (counted.count > RATE_LIMITS.passwordChangePerUser.limit) {
        ctx.audit.set(
          counted.count === RATE_LIMITS.passwordChangePerUser.limit + 1
            ? { diff: { reasonCode: 'rate_limited' } }
            : { skipFailureAudit: true },
        );
        throw tooMany();
      }
      const result = await account.changePassword(
        ctx.db,
        userId,
        ctx.session.sessionId,
        input.currentPassword,
        input.newPassword,
        ctx.breachCheck,
      );
      // The current password was right: nothing to count against her.
      if (!result.ok && result.reason === 'breached_password') {
        await refund(ctx.db, RATE_LIMITS.passwordChangePerUser, userId, counted);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'PASSWORD_BREACHED' });
      }
      if (!result.ok) {
        ctx.audit.set({ diff: { reasonCode: 'wrong_password' } });
        // FORBIDDEN, not BAD_REQUEST: a refused password is audited (`.failed`), bad input is not.
        throw new TRPCError({ code: 'FORBIDDEN', message: 'WRONG_PASSWORD' });
      }
      await refund(ctx.db, RATE_LIMITS.passwordChangePerUser, userId, counted);
      ctx.audit.set({ diff: { otherSessionsEnded: true } });
      return { ok: true as const };
    }),

  /** „Prístup pre Claude“: her personal access tokens, never their values. */
  accessTokens: protectedProcedure.query(({ ctx }) => listAccessTokens(ctx.db, ctx.session.userId)),

  /** A new token for Claude Code; its value is in this answer only. */
  createAccessToken: protectedProcedure
    .input(createAccessTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await createAccessToken(ctx.db, ctx.session.userId, input);
      ctx.audit.set({
        userId: ctx.session.userId,
        entityType: 'access_token',
        entityId: created.id,
        diff: { days: input.days },
      });
      return created;
    }),

  revokeAccessToken: protectedProcedure
    .input(accessTokenIdSchema)
    .mutation(async ({ ctx, input }) => {
      const revoked = await revokeAccessToken(ctx.db, ctx.session.userId, input.id);
      if (!revoked) throw new TRPCError({ code: 'NOT_FOUND' });
      ctx.audit.set({
        userId: ctx.session.userId,
        entityType: 'access_token',
        entityId: input.id,
        diff: { revoked: true },
      });
      return { ok: true as const };
    }),

  /** „Aktívne prihlásenia“: her live sessions, this one marked. */
  sessions: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await auth.listSessions(ctx.db, ctx.session.userId);
    return sessions.map((s) => ({ ...s, current: s.sessionId === ctx.session.sessionId }));
  }),

  /** „Odhlásiť“ next to one of her other sessions. */
  endSession: protectedProcedure.input(endSessionSchema).mutation(async ({ ctx, input }) => {
    auditSelf(ctx);
    if (input.sessionId === ctx.session.sessionId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'CURRENT_SESSION' });
    }
    const ended = await auth.revokeSessionFamily(ctx.db, ctx.session.userId, input.sessionId);
    ctx.audit.set({ diff: { sessionId: input.sessionId } });
    return { ended };
  }),

  /** „Odhlásiť ostatné“: every other session of hers ends; this one stays. */
  endOtherSessions: protectedProcedure.mutation(async ({ ctx }) => {
    auditSelf(ctx);
    await auth.revokeOtherSessions(ctx.db, ctx.session.userId, ctx.session.sessionId, {
      forgetDevices: false,
    });
    ctx.audit.set({ diff: { otherSessionsEnded: true } });
    return { ok: true as const };
  }),

  /** The factor in force and how many recovery codes are left. */
  secondFactorStatus: protectedProcedure.query(({ ctx }) =>
    secondFactor.secondFactorStatus(ctx.db, ctx.session.userId),
  ),

  /**
   * A new phone: her password and a code of the factor in force (or a recovery code), so that a
   * stolen session with a phished password cannot move her factor to the thief's phone. The secret
   * comes back as a QR code's text and as the secret itself; the old phone holds until a code of
   * the new one is confirmed.
   */
  secondFactorSetup: protectedProcedure
    .meta({ auditFailure: true })
    .input(accountSecondFactorSetupSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.userId;
      auditSelf(ctx);
      await confirmPassword(ctx, input.password);
      const attempt = await countCodeAttempt(ctx, userId, { perIp: false });
      const verified = await secondFactor.verifySecondFactor(ctx.db, ctx.env, userId, input.code);
      if (!verified.ok) throw await attempt.wrong();
      await attempt.refund();
      ctx.audit.set({ diff: { replaced: true } });
      return secondFactor.beginSetup(ctx.db, ctx.env, userId);
    }),

  /**
   * Its first code puts the new phone in force: the old secret is gone, the recovery codes are new
   * and shown once, every trusted browser must pass the new one, and every other session of hers
   * ends. She is told by e-mail.
   */
  secondFactorConfirm: protectedProcedure
    .meta({ auditFailure: true })
    .input(accountSecondFactorConfirmSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.userId;
      auditSelf(ctx);
      const counted = await hit(ctx.db, RATE_LIMITS.secondFactorConfirmPerUser, userId);
      if (counted.count > RATE_LIMITS.secondFactorConfirmPerUser.limit) {
        ctx.audit.set(
          counted.count === RATE_LIMITS.secondFactorConfirmPerUser.limit + 1
            ? { diff: { reasonCode: 'rate_limited' } }
            : { skipFailureAudit: true },
        );
        throw tooMany();
      }
      const confirmed = await secondFactor.confirmSetup(ctx.db, ctx.env, userId, input.code);
      if (!confirmed.ok) {
        ctx.audit.set({ diff: { reasonCode: 'wrong_code' } });
        throw new TRPCError({ code: 'FORBIDDEN', message: 'WRONG_CODE' });
      }
      await refund(ctx.db, RATE_LIMITS.secondFactorConfirmPerUser, userId, counted);
      await auth.revokeOtherSessions(ctx.db, userId, ctx.session.sessionId, {
        forgetDevices: true,
      });
      await enqueueMail(ctx.db, {
        kind: 'second_factor_changed',
        userId,
        change: confirmed.replaced ? 'replaced' : 'enabled',
      });
      ctx.audit.set({
        diff: {
          recoveryCodesLeft: confirmed.recoveryCodes.length,
          replaced: confirmed.replaced,
          otherSessionsEnded: true,
        },
      });
      return { recoveryCodes: confirmed.recoveryCodes };
    }),

  /** A fresh set of recovery codes, the old ones void. Her password first. */
  newRecoveryCodes: protectedProcedure
    .meta({ auditFailure: true })
    .input(accountRecoveryCodesSchema)
    .mutation(async ({ ctx, input }) => {
      auditSelf(ctx);
      await confirmPassword(ctx, input.password);
      const recoveryCodes = await secondFactor.newRecoveryCodes(ctx.db, ctx.session.userId);
      ctx.audit.set({ diff: { recoveryCodesLeft: recoveryCodes.length } });
      return { recoveryCodes };
    }),
});
