import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isSensitiveKey, REDACTED } from '@intra/shared/observability';
import type { Params } from 'nestjs-pino';

type PinoHttpOptions = Exclude<
  NonNullable<Params['pinoHttp']>,
  readonly unknown[] | { write: unknown }
>;

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

/** Reuses a well-formed `x-request-id` from the proxy, otherwise generates one. */
export function requestIdFrom(req: IncomingMessage): string {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}

const MAX_DEPTH = 5;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * The safety net under CLAUDE.md rule 6 (ADR-006 amendment ALMA-93): every key of
 * `SENSITIVE_KEYS`, at any depth of the object a line is logged with (`{ patient: { firstName } }`,
 * `{ input: { records: [{ subjective }] } }`), becomes `[redacted]`, and so does whatever is nested
 * deeper than anybody logs on purpose. Log lines are still built from ids, codes and counts; this
 * is for the object somebody logs by mistake.
 *
 * Only plain objects and arrays are walked: an `Error` goes to pino's serializer as it is (the
 * code logs errors through `describeError`, never whole), and the raw request and response go to
 * the serializers below. A pino `redact` list with wildcards did the same at 0.4 ms per line.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value))
    out[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(item, depth + 1);
  return out;
}

export function loggerOptions(): PinoHttpOptions {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    genReqId: requestIdFrom,
    // Never log bodies or query strings: tRPC puts query input into the URL and it may contain health data.
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        path: req.url.split('?')[0],
      }),
      // Status only: response headers carry Set-Cookie with the session tokens.
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    formatters: { log: (object) => redactSensitive(object) as Record<string, unknown> },
    ...(process.env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}
