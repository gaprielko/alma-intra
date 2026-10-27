import {
  acceptInvitationSchema,
  checkInvitationSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  secondFactorEnrolSchema,
  secondFactorSetupSchema,
  secondFactorVerifySchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as account from '../auth/account.service.js';
import * as auth from '../auth/auth.service.js';
import {
  clearAuthCookies,
  readCookie,
  REFRESH_COOKIE,
  setAuthCookies,
  setTrustedDeviceCookie,
  TRUSTED_DEVICE_COOKIE,
} from '../auth/cookies.js';
import * as secondFactor from '../auth/second-factor.service.js';
import { enqueueMail } from '../mail/mail-outbox.js';
import {
  claimOnce,
  type Hit,
  hit,
  ipSubject,
  lockLogin,
  loginLockedUntil,
  RATE_LIMITS,
  refund,
  releaseOnce,
  secondFactorLockedUntil,
  unlockLogin,
} from '../security/rate-limit.js';
import type { Context } from './context.js';
import { countCodeAttempt } from './second-factor-attempt.js';
import { limitPerIp, protectedProcedure, publicProcedure, router } from './trpc.js';

/** Auth events have no session yet, so the procedure names the user the event is about. */
const auditUser = (ctx: Context, userId: string | null | undefined) => {
  if (userId) ctx.audit.set({ userId, entityType: 'user', entityId: userId });
};

const userAgentOf = (ctx: Context) => ctx.req.headers['user-agent']?.slice(0, 200) ?? null;

const tooMany = () => new TRPCError({ code: 'TOO_MANY_REQUESTS' });
const breached = () => new TRPCError({ code: 'BAD_REQUEST', message: 'PASSWORD_BREACHED' });
const PER_EMAIL = RATE_LIMITS.loginFailuresPerEmail;

/**
 * Before a password is checked for an e-mail: refused while the e-mail is locked, then counted.
 * Each attempt is counted before the check and given back on success; checking first and counting
 * later would let parallel attempts all slip through. A known and an unknown e-mail are treated
 * alike, and the refusal comes before any password hashing, so neither the answer nor its timing
 * tells them apart. Refusals leave no event: the lock was recorded when it was set.
 */
async function countPasswordAttempt(ctx: Context, email: string): Promise<Hit> {
  if (await loginLockedUntil(ctx.db, email)) {
    ctx.audit.set({ skipFailureAudit: true });
    throw tooMany();
  }
  const counted = await hit(ctx.db, PER_EMAIL, email);
  // Parallel attempts that passed the lock check before the lock was set.
  if (counted.count > PER_EMAIL.limit) {
    ctx.audit.set({ skipFailureAudit: true });
    throw tooMany();
  }
  return counted;
}

/** After a wrong password: the failure that reaches the limit locks the e-mail, and its event says so. */
async function lockWhenLimitReached(ctx: Context, email: string, counted: Hit) {
  if (counted.count < PER_EMAIL.limit) return;
  const { minutes } = await lockLogin(ctx.db, email);
  ctx.audit.set({ diff: { reasonCode: 'locked', lockMinutes: minutes } });
}

/** A challenge for the step still owed. While her second step is locked the password gets nothing. */
async function secondStepAnswer(ctx: Context, userId: string, step: secondFactor.SecondStep) {
  if (step === 'verify' && (await secondFactorLockedUntil(ctx.db, userId))) {
    ctx.audit.set({ skipFailureAudit: true });
    throw tooMany();
  }
  ctx.audit.set({ diff: { secondStep: step } });
  return {
    secondStep: {
      kind: step,
      challenge: await secondFactor.signChallenge(ctx.db, ctx.env, userId, step),
    },
  };
}

const challengeExpired = () =>
  new TRPCError({ code: 'UNAUTHORIZED', message: 'CHALLENGE_EXPIRED' });

/**
 * The challenge of a second-step call and whose it is. A forged, expired or foreign-step
 * challenge is nobody's, and so is one issued before her sessions were last ended wholesale:
 * refused without an event, like any anonymous call.
 */
async function challengedUser(ctx: Context, token: string, step: secondFactor.SecondStep) {
  const challenge = await secondFactor.verifyChallenge(ctx.env, token, step);
  const holder = challenge ? await secondFactor.challengeHolder(ctx.db, challenge) : null;
  if (!challenge || !holder) {
    ctx.audit.set({ skipFailureAudit: true });
    throw challengeExpired();
  }
  auditUser(ctx, challenge.userId);
  return { challenge, userId: challenge.userId, email: holder.email };
}

/**
 * A challenge opens one session: taken before the code is checked, so that a second request with
 * the same challenge is refused whatever code it carries, and given back when the code was wrong,
 * so that a mistyped code does not send her back to the password.
 */
async function takeChallenge(ctx: Context, challenge: secondFactor.Challenge) {
  const args = [secondFactor.CHALLENGE_CLAIM_SCOPE, challenge.jti, challenge.expiresAt] as const;
  if (!(await claimOnce(ctx.db, ...args))) {
    ctx.audit.set({ skipFailureAudit: true });
    throw challengeExpired();
  }
  return () => releaseOnce(ctx.db, ...args);
}

/** The session the second step was for; the browser trusted for 30 days when she asked. */
async function startSession(ctx: Context, userId: string, rememberDevice: boolean) {
  const tokens = await auth.startSession(ctx.db, ctx.env, userId, userAgentOf(ctx));
  // Deactivated while she typed the code: no session, like a login.
  if (!tokens) throw challengeExpired();
  if (rememberDevice) {
    const trusted = await secondFactor.trustDevice(ctx.db, userId);
    setTrustedDeviceCookie(ctx.res, trusted.token, trusted.expiresAt);
  }
  setAuthCookies(ctx.res, tokens);
}

export const authRouter = router({
  login: publicProcedure
    .meta({ auditFailure: true })
    .input(loginSchema)
    .mutation(async ({ ctx, input }) => {
      // Only failures count, so a person who logs in often is never locked out by that alone.
      // The address first: once it is over its limit it must not be able to run up the counters
      // (and lock the accounts) of every e-mail it names, nor leave a trace per e-mail.
      const ip = ipSubject(ctx.req.ip);
      const perIp = await hit(ctx.db, RATE_LIMITS.loginFailuresPerIp, ip);
      if (perIp.count > RATE_LIMITS.loginFailuresPerIp.limit) {
        ctx.audit.set(
          perIp.count === RATE_LIMITS.loginFailuresPerIp.limit + 1
            ? { diff: { reasonCode: 'rate_limited' } }
            : { skipFailureAudit: true },
        );
        throw tooMany();
      }
      const perEmail = await countPasswordAttempt(ctx, input.email);

      const result = await auth.login(ctx.db, {
        ...input,
        trustedDeviceToken: readCookie(ctx.req, TRUSTED_DEVICE_COOKIE),
      });
      if (!result.ok) {
        auditUser(ctx, result.userId);
        ctx.audit.set({ diff: { reasonCode: result.reason } });
        // Only a wrong password (or an unknown e-mail) locks; `deactivated` came with the right one.
        if (result.reason === 'invalid') await lockWhenLimitReached(ctx, input.email, perEmail);
        throw result.reason === 'deactivated'
          ? new TRPCError({ code: 'FORBIDDEN', message: 'USER_DEACTIVATED' })
          : new TRPCError({ code: 'UNAUTHORIZED' });
      }
      await Promise.all([
        refund(ctx.db, RATE_LIMITS.loginFailuresPerIp, ip, perIp),
        refund(ctx.db, PER_EMAIL, input.email, perEmail),
      ]);
      auditUser(ctx, result.userId);
      if ('secondStep' in result) return secondStepAnswer(ctx, result.userId, result.secondStep);
      // A browser she trusted at the second step: the password was enough here.
      await startSession(ctx, result.userId, false);
      ctx.audit.set({ diff: { rememberDevice: true } });
      return { secondStep: null };
    }),

  /**
   * The second step: a code of her authenticator, or one of her recovery codes, with the
   * challenge the password earned. Counted like a password (`countCodeAttempt`); a code is taken
   * once, never twice within its window. The session starts only here.
   */
  secondFactorVerify: publicProcedure
    .meta({ auditFailure: true })
    .input(secondFactorVerifySchema)
    .mutation(async ({ ctx, input }) => {
      const { challenge, userId, email } = await challengedUser(ctx, input.challenge, 'verify');
      const attempt = await countCodeAttempt(ctx, userId, { email, perIp: true });
      const release = await takeChallenge(ctx, challenge);
      const verified = await secondFactor.verifySecondFactor(ctx.db, ctx.env, userId, input.code);
      if (!verified.ok) {
        await release();
        throw await attempt.wrong();
      }
      await attempt.refund();
      ctx.audit.set({
        diff: {
          method: verified.method,
          rememberDevice: input.rememberDevice,
          recoveryCodesLeft: verified.recoveryCodesLeft,
        },
      });
      await startSession(ctx, userId, input.rememberDevice);
      return { method: verified.method, recoveryCodesLeft: verified.recoveryCodesLeft };
    }),

  /**
   * A first setup (a new user right after her password, or after a colleague reset her factor):
   * the secret of her authenticator, as a QR code's text and as text, still before any session.
   * Pressed again it makes a new one; only a login that owes a setup gets one.
   */
  secondFactorSetup: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .input(secondFactorSetupSchema)
    .mutation(async ({ ctx, input }) => {
      const { userId } = await challengedUser(ctx, input.challenge, 'enrol');
      if ((await secondFactor.secondStepFor(ctx.db, userId, undefined)) !== 'enrol') {
        throw challengeExpired();
      }
      ctx.audit.set({ diff: { secondStep: 'enrol' } });
      return secondFactor.beginSetup(ctx.db, ctx.env, userId);
    }),

  /**
   * …and its first code: the factor is in force, the recovery codes are shown once, and the session
   * starts. A wrong code is counted like one at the second step.
   */
  secondFactorEnrol: publicProcedure
    .meta({ auditFailure: true })
    .input(secondFactorEnrolSchema)
    .mutation(async ({ ctx, input }) => {
      const { challenge, userId, email } = await challengedUser(ctx, input.challenge, 'enrol');
      if ((await secondFactor.secondStepFor(ctx.db, userId, undefined)) !== 'enrol') {
        ctx.audit.set({ skipFailureAudit: true });
        throw challengeExpired();
      }
      const attempt = await countCodeAttempt(ctx, userId, { email, perIp: true });
      const release = await takeChallenge(ctx, challenge);
      const confirmed = await secondFactor.confirmSetup(ctx.db, ctx.env, userId, input.code);
      if (!confirmed.ok) {
        await release();
        throw await attempt.wrong();
      }
      await attempt.refund();
      // Every session she already had ends before the new one starts.
      await auth.revokeUserSessions(ctx.db, userId);
      // Queued, like every mail: a change she did not make is noticed.
      await enqueueMail(ctx.db, { kind: 'second_factor_changed', userId, change: 'enabled' });
      ctx.audit.set({
        diff: {
          secondStep: 'enrol',
          rememberDevice: input.rememberDevice,
          recoveryCodesLeft: confirmed.recoveryCodes.length,
        },
      });
      await startSession(ctx, userId, input.rememberDevice);
      return { recoveryCodes: confirmed.recoveryCodes };
    }),

  refresh: publicProcedure
    .use(limitPerIp(RATE_LIMITS.refreshPerIp))
    .meta({ audit: false })
    .mutation(async ({ ctx }) => {
      const presented = readCookie(ctx.req, REFRESH_COOKIE);
      const tokens = presented ? await auth.refresh(ctx.db, ctx.env, presented) : null;
      if (!tokens) {
        clearAuthCookies(ctx.res);
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      setAuthCookies(ctx.res, tokens);
      return { ok: true as const };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    const presented = readCookie(ctx.req, REFRESH_COOKIE);
    const userId = presented ? await auth.logout(ctx.db, presented) : null;
    if (presented) auditUser(ctx, userId);
    clearAuthCookies(ctx.res);
    return { ok: true as const };
  }),

  /**
   * What the activation page shows. A mutation on purpose: the token travels in the POST body and
   * never in a URL. It changes nothing, so it is not audited.
   */
  checkInvitation: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .meta({ audit: false })
    .input(checkInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      const invitation = await account.findUsableInvitation(ctx.db, input.token);
      if (!invitation) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_OR_EXPIRED_TOKEN' });
      }
      return { email: invitation.email, expiresAt: invitation.expiresAt };
    }),

  /**
   * Sets the first password and makes the user active; the answer is a setup challenge for the
   * second factor, so the page goes straight on to the QR code. A first password must not be known
   * from a breach.
   */
  acceptInvitation: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .input(acceptInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      const accepted = await account.acceptInvitation(
        ctx.db,
        input.token,
        input.password,
        ctx.breachCheck,
      );
      if (!accepted.ok) {
        if (accepted.reason === 'breached_password') throw breached();
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_OR_EXPIRED_TOKEN' });
      }
      auditUser(ctx, accepted.userId);
      return secondStepAnswer(ctx, accepted.userId, 'enrol');
    }),

  /** Always answers the same, whether or not the e-mail belongs to an account. */
  requestPasswordReset: publicProcedure
    .use(limitPerIp(RATE_LIMITS.passwordResetPerIp))
    .input(forgotPasswordSchema)
    .mutation(async ({ ctx, input }) => {
      // Over the limit for one address: same answer, no e-mail. Nobody's inbox gets flooded.
      const requests = await hit(ctx.db, RATE_LIMITS.passwordResetPerEmail, input.email);
      if (requests.count > RATE_LIMITS.passwordResetPerEmail.limit) return { ok: true as const };
      const reset = await account.requestPasswordReset(ctx.db, input.email);
      auditUser(ctx, reset?.userId);
      // Queued, not sent: the token is created and the provider called by the worker.
      if (reset) await enqueueMail(ctx.db, { kind: 'password_reset', userId: reset.userId });
      return { ok: true as const };
    }),

  /**
   * Sets a new password from the mailed link. The link proves the mailbox, so it also ends a login
   * lock of the account's e-mail; a password known from a breach is refused. No session starts: a
   * mailbox is not a second factor, she signs in with both steps.
   */
  resetPassword: publicProcedure
    .use(limitPerIp(RATE_LIMITS.oneTimeToken))
    .input(resetPasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const reset = await account.resetPassword(
        ctx.db,
        input.token,
        input.password,
        ctx.breachCheck,
      );
      if (!reset.ok) {
        if (reset.reason === 'breached_password') throw breached();
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_OR_EXPIRED_TOKEN' });
      }
      auditUser(ctx, reset.userId);
      // Never fatal: the password is already changed, and a lock left in place only fails closed.
      if (await unlockLogin(ctx.db, reset.email).catch(() => false)) {
        ctx.audit.set({ diff: { loginUnlocked: true } });
      }
      return { ok: true as const };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await auth.me(ctx.db, ctx.session.userId);
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return user;
  }),
});
