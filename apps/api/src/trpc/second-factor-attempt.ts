import { TRPCError } from '@trpc/server';
import {
  hit,
  ipSubject,
  lockSecondFactor,
  loginLockedUntil,
  RATE_LIMITS,
  refund,
  secondFactorLockedUntil,
} from '../security/rate-limit.js';
import type { Context } from './context.js';

const tooMany = () => new TRPCError({ code: 'TOO_MANY_REQUESTS' });
const FAILURES = RATE_LIMITS.secondFactorFailuresPerUser;
const PER_IP = RATE_LIMITS.loginFailuresPerIp;

/**
 * A code of her second factor is a guess: the second step of a login, or the current code asked
 * before the factor is moved to a new phone on „Môj účet“. Counted before it is checked and given
 * back when right (checking first would let parallel guesses slip through), per user under the
 * second step's own key, which a password reset does not clear, and at the login per address as
 * well. The failure that reaches ten locks her second step for 15,
 * then 30, then 60 minutes; while it lasts every code is refused, the right one too, and so is
 * the login that would owe one. A locked login e-mail stops the second step as well.
 * Refusals under a lock leave no event, like the login's.
 */
export async function countCodeAttempt(
  ctx: Context,
  userId: string,
  options: { email?: string; perIp: boolean },
) {
  const ip = ipSubject(ctx.req.ip);
  const perIp = options.perIp ? await hit(ctx.db, PER_IP, ip) : null;
  if (perIp && perIp.count > PER_IP.limit) {
    ctx.audit.set(
      perIp.count === PER_IP.limit + 1
        ? { diff: { reasonCode: 'rate_limited' } }
        : { skipFailureAudit: true },
    );
    throw tooMany();
  }
  const locked =
    (await secondFactorLockedUntil(ctx.db, userId)) ??
    (options.email ? await loginLockedUntil(ctx.db, options.email) : null);
  if (locked) {
    ctx.audit.set({ skipFailureAudit: true });
    throw tooMany();
  }
  const counted = await hit(ctx.db, FAILURES, userId);
  // Parallel guesses that passed the lock check before the lock was set.
  if (counted.count > FAILURES.limit) {
    ctx.audit.set({ skipFailureAudit: true });
    throw tooMany();
  }
  return {
    refund: async () => {
      await refund(ctx.db, FAILURES, userId, counted);
      if (perIp) await refund(ctx.db, PER_IP, ip, perIp);
    },
    /** The error to throw for a wrong code; the one that reaches the limit locks, and says so. */
    wrong: async () => {
      ctx.audit.set({ diff: { reasonCode: 'wrong_code' } });
      if (counted.count >= FAILURES.limit) {
        const { minutes } = await lockSecondFactor(ctx.db, userId);
        ctx.audit.set({ diff: { reasonCode: 'locked', lockMinutes: minutes } });
      }
      return new TRPCError({ code: 'FORBIDDEN', message: 'WRONG_CODE' });
    },
  };
}
