import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { Actor } from '@intra/shared/auth';
import type { Request, Response } from 'express';
import { AuditTrail } from '../audit/audit.js';
import { sessionUser } from '../auth/auth.service.js';
import { ACCESS_COOKIE, readCookie } from '../auth/cookies.js';
import { verifyAccessToken } from '../auth/tokens.js';
import type { Env } from '../config/env.js';
import type { Db } from '../db/db.module.js';
import type { BreachCheck } from '../security/breached-password.js';

export interface Context {
  db: Db;
  env: Env;
  req: Request;
  res: Response;
  /**
   * From a verified access token whose session is still alive and whose user is active; `null`
   * when anonymous. Established here and nowhere else.
   */
  session: { userId: string; sessionId: string; actor: Actor } | null;
  /**
   * Whether a new password is known from a breach (Have I Been Pwned); `null` when switched off.
   * Fail-open: never throws, an unreachable HIBP answers `false`.
   */
  breachCheck: BreachCheck | null;
  requestId: string;
  /**
   * Lets a procedure add what only it knows to its audit event (acting user, entity, diff).
   * Replaced with a fresh trail for every procedure call by `publicProcedure`: the context itself
   * is shared by all calls of a batched HTTP request.
   */
  audit: AuditTrail;
}

/**
 * The access token is only as good as its session: `sid` is the refresh token family, and once
 * that is revoked (logout, reuse, a deactivated user) the token is refused at once instead of
 * within its 15 minutes. One indexed lookup per HTTP request, however many calls it batches. The
 * client sees the same 401 as for an expired token: it tries to refresh, that fails, it logs out.
 */
async function sessionFrom(db: Db, env: Env, req: Request): Promise<Context['session']> {
  const token = readCookie(req, ACCESS_COOKIE);
  const claims = token ? await verifyAccessToken(token, env.AUTH_ACCESS_SECRET) : null;
  if (!claims) return null;
  const user = await sessionUser(db, claims.userId, claims.sessionId);
  return user ? { ...claims, actor: { userId: claims.userId, role: user.role } } : null;
}

export function createContextFactory(db: Db, env: Env, breachCheck: BreachCheck | null) {
  return async ({ req, res }: CreateExpressContextOptions): Promise<Context> => {
    return {
      db,
      env,
      req,
      res,
      session: await sessionFrom(db, env, req),
      breachCheck,
      // Assigned by the request logger, so log lines and the context share one id.
      requestId: String((req as { id?: unknown }).id),
      audit: new AuditTrail(),
    };
  };
}
