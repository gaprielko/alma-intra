import { sk } from '@intra/shared/i18n';
import { TRPCClientError } from '@trpc/client';

const { BAD_REQUEST, FORBIDDEN, NOT_FOUND, TOO_MANY_REQUESTS } = sk.errors;
/** Refusals every screen may meet, by the tRPC code. */
const shared = { BAD_REQUEST, FORBIDDEN, NOT_FOUND, TOO_MANY_REQUESTS };

/**
 * The one mapping from a failed tRPC call to text. `specific` is the screen's own wording, keyed
 * by the server's reason (`EMAIL_TAKEN`, the error message) or by the tRPC code (`UNAUTHORIZED`);
 * then the shared text for the code (`sk.errors`), then `fallback`.
 */
export function errorMessage(
  error: unknown,
  specific: Readonly<Record<string, string>> = {},
  fallback: string = sk.errors.generic,
): string {
  if (!(error instanceof TRPCClientError)) return fallback;
  const code = (error.data as { code?: string } | undefined)?.code;
  for (const key of [error.message, code]) {
    if (key !== undefined && Object.hasOwn(specific, key)) return specific[key]!;
  }
  for (const key of [error.message, code]) {
    if (key !== undefined && Object.hasOwn(shared, key)) return shared[key as keyof typeof shared];
  }
  return fallback;
}

/** The server's own reason for a refusal (`EMAIL_TAKEN`), when it gave one. */
export function errorReason(error: unknown): string | undefined {
  return error instanceof TRPCClientError ? error.message : undefined;
}

/** The tRPC code of a refusal (`NOT_FOUND`), when the server gave one. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof TRPCClientError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;
}
