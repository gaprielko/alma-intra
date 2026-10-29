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
  // Refused input: name the fields, since the screen may not show them under any field.
  const fields = invalidFields(error);
  if (code === 'BAD_REQUEST' && fields.length > 0) return sk.errors.checkFields(fields.join(', '));
  for (const key of [error.message, code]) {
    if (key !== undefined && Object.hasOwn(specific, key)) return specific[key]!;
  }
  for (const key of [error.message, code]) {
    if (key !== undefined && Object.hasOwn(shared, key)) return shared[key as keyof typeof shared];
  }
  return fallback;
}

/** The fields the server's Zod refused (`customer.phone` → „telefón“), in Slovak, once each. */
function invalidFields(error: { data?: unknown }): string[] {
  const data = error.data as
    | { zodError?: { fieldErrors?: Record<string, unknown>; formErrors?: string[] } | null }
    | undefined;
  const paths = Object.keys(data?.zodError?.fieldErrors ?? {});
  const names = paths.map((path) => {
    const parts = path.split('.');
    const leaf = parts[parts.length - 1]!;
    const group = parts.find((part) => Object.hasOwn(sk.errors.fieldGroups, part));
    const name = Object.hasOwn(sk.errors.fieldNames, leaf)
      ? sk.errors.fieldNames[leaf as keyof typeof sk.errors.fieldNames]
      : leaf;
    return group
      ? `${name} (${sk.errors.fieldGroups[group as keyof typeof sk.errors.fieldGroups]})`
      : name;
  });
  return [...new Set(names)];
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
