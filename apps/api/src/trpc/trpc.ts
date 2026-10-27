import { type Action, can, type Resource } from '@intra/shared/auth';
import { Logger } from '@nestjs/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { type DeniedReason, writeAuditEvent } from '../audit/audit.js';
import { AuditTrail } from '../audit/audit.js';
import { describeError } from '../logging/describe-error.js';
import { hit, ipSubject, RATE_LIMITS, type RateLimitRule } from '../security/rate-limit.js';
import type { Context } from './context.js';

export interface ProcedureMeta {
  /** Opt a mutation out of the audit trail. Only for `auth.refresh`, which is pure token rotation. */
  audit?: false;
  /** Also record the refused call, as `<path>.failed`. For `auth.login`: guessing must leave a trace. */
  auditFailure?: boolean;
}

/** What every message of ours is: a code (`EMAIL_TAKEN`), never words about the input. */
const SERVER_CODE = /^[A-Z][A-Z0-9_]*$/;
/** The shared schemas' own messages are keys of `sk.validation` (`invalid_email`). */
const VALIDATION_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * The field errors of invalid input, each message a key and never a value. Zod's own messages
 * quote what was sent, so any message that is not a key of ours becomes the issue's code
 * (`invalid_string`), which the web shows as „invalid“.
 */
function fieldErrorsOf(error: ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of error.issues) {
    const message = VALIDATION_KEY.test(issue.message) ? issue.message : issue.code;
    const field = issue.path[0];
    if (field === undefined) formErrors.push(message);
    else (fieldErrors[String(field)] ??= []).push(message);
  }
  return { formErrors, fieldErrors };
}

const t = initTRPC
  .context<Context>()
  .meta<ProcedureMeta>()
  .create({
    // Invalid input is already a BAD_REQUEST; expose the field errors so forms can map them. An
    // unexpected error (a failed query carries its SQL and parameters) never leaves the server:
    // the client gets a fixed message, the cause is logged by `onError` in the tRPC module. No
    // message echoes the input: ours are codes, and any other one becomes the tRPC code.
    errorFormatter: ({ shape, error }) => {
      const invalidInput = error.code === 'BAD_REQUEST' && error.cause instanceof ZodError;
      return {
        ...shape,
        message:
          error.code !== 'INTERNAL_SERVER_ERROR' && !invalidInput && SERVER_CODE.test(shape.message)
            ? shape.message
            : error.code,
        data: {
          ...shape.data,
          stack: undefined,
          zodError: invalidInput ? fieldErrorsOf(error.cause) : null,
        },
      };
    },
  });

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * The audit interceptor: one event per successful mutation, and for a procedure with
 * `auditFailure` one per refused call (`<path>.failed`).
 */
export const publicProcedure = t.procedure.use(
  async ({ ctx, next, type, path, meta, getRawInput }) => {
    // The context is built once per HTTP request and a batch carries up to ten calls: a trail
    // shared between them would let one call's entity or diff end up in another call's event.
    const audit = new AuditTrail();
    const result = await next({ ctx: { ...ctx, audit } });
    // Input that never reached the resolver (BAD_REQUEST) was not counted by any limit either, so
    // auditing it would let anybody fill the append-only table for free.
    if (
      !result.ok &&
      meta?.auditFailure &&
      !audit.details.skipFailureAudit &&
      result.error.code !== 'INTERNAL_SERVER_ERROR' &&
      result.error.code !== 'BAD_REQUEST'
    ) {
      await writeAuditEvent({
        db: ctx.db,
        req: ctx.req,
        requestId: ctx.requestId,
        path: `${path}.failed`,
        kind: 'mutation',
        // The e-mail somebody typed is not ours to keep; the user id is there when it matched.
        input: null,
        result: null,
        trail: audit,
        sessionUserId: ctx.session?.userId ?? null,
      });
    }
    if (result.ok && type === 'mutation' && meta?.audit !== false) {
      await writeAuditEvent({
        db: ctx.db,
        req: ctx.req,
        requestId: ctx.requestId,
        path,
        kind: 'mutation',
        input: await getRawInput(),
        result: result.data,
        trail: audit,
        sessionUserId: ctx.session?.userId ?? null,
      });
    }
    return result;
  },
);

/** Counts every call from an IP address and refuses the ones over the limit. */
export const limitPerIp = (rule: RateLimitRule) =>
  t.middleware(async ({ ctx, next }) => {
    // Behind the proxy `req.ip` is the client only because `main.ts` sets `trust proxy`.
    if ((await hit(ctx.db, rule, ipSubject(ctx.req.ip))).count > rule.limit) {
      // On a procedure that audits its refusals the flood must not fill the append-only table.
      ctx.audit.set({ skipFailureAudit: true });
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }
    return next();
  });

/** Signed in: a live session of an active user (who passed the second factor to get it). */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    // Nobody to count it against: an anonymous call must not leave a `.failed` event.
    ctx.audit.set({ skipFailureAudit: true });
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

const logger = new Logger('audit');

/**
 * Refused access leaves a trace: `<path>.denied` with the user and a reason code, never the input.
 * Capped per user: past the limit the refusals go on, their events do not, so nobody can fill the
 * append-only table.
 */
async function auditDenied(
  ctx: Context & { session: NonNullable<Context['session']> },
  path: string,
  type: string,
  getRawInput: () => Promise<unknown>,
  reason: DeniedReason,
) {
  // The caller must get the refusal it earned, whatever happens to its audit event.
  try {
    const rule = RATE_LIMITS.deniedAuditPerUser;
    if ((await hit(ctx.db, rule, ctx.session.userId)).count > rule.limit) return;
    await writeAuditEvent({
      db: ctx.db,
      req: ctx.req,
      requestId: ctx.requestId,
      path: `${path}.denied`,
      kind: type === 'mutation' ? 'mutation' : 'read',
      // Only for the entity id; a refused call gets no field list.
      input: await getRawInput(),
      result: null,
      trail: ctx.audit,
      sessionUserId: ctx.session.userId,
      denied: { reason },
    });
  } catch (error) {
    // Ids and error names only.
    logger.error({
      msg: 'denied audit event not written',
      path,
      requestId: ctx.requestId,
      userId: ctx.session.userId,
      ...describeError(error),
    });
  }
}

/**
 * A procedure gated on one `can()` action. The resource comes from the input when the decision
 * depends on it (`user.deactivate` of herself): `resourceOf` reads it from the raw input, which
 * is parsed again by the procedure's own schema.
 */
export function authorizedProcedure(
  action: Action,
  resourceOf: (input: unknown) => Resource = () => ({}),
) {
  return protectedProcedure.use(async ({ ctx, next, path, type, getRawInput }) => {
    const resource = resourceOf(await getRawInput());
    if (!can(ctx.session.actor, action, resource)) {
      await auditDenied(ctx, path, type, getRawInput, 'role');
      ctx.audit.set({ skipFailureAudit: true });
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next();
  });
}

/** The user an input names (`{ userId }`), for `authorizedProcedure`. */
export const targetUser = (input: unknown): Resource => {
  const userId =
    input && typeof input === 'object' ? (input as { userId?: unknown }).userId : undefined;
  return typeof userId === 'string' ? { userId } : {};
};
