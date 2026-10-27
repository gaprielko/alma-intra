import { sk } from '@intra/shared/i18n';
import { TRPCClientError } from '@trpc/client';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { errorReason } from './errors';

/**
 * Field errors carry a key, not text: the shared Zod schemas use snake_case keys as messages
 * (`invalid_email`). Anything else is Zod's English default: "required" when the field was left
 * empty, "invalid" otherwise; a name of one letter is too short, not missing. A format key
 * (`invalid_…`) on an empty field is a missing value too: „Povinné pole“, not „Neplatný e-mail“.
 */
export function validationMessage(error: { message?: string | undefined }, isEmpty: boolean) {
  const key = error.message;
  if (isEmpty && key?.startsWith('invalid')) return sk.validation.required;
  if (key !== undefined && Object.hasOwn(sk.validation, key))
    return sk.validation[key as keyof typeof sk.validation];
  return isEmpty ? sk.validation.required : sk.validation.invalid;
}

/** The server's Zod errors (`error.data.zodError.fieldErrors`, see the API's error formatter): the first message per field. */
export function serverFieldErrors(error: unknown): [field: string, message: string][] {
  if (!(error instanceof TRPCClientError)) return [];
  const data = error.data as
    { zodError?: { fieldErrors?: Record<string, string[] | undefined> } | null } | undefined;
  return Object.entries(data?.zodError?.fieldErrors ?? {}).flatMap(([field, messages]) =>
    messages?.[0] === undefined ? [] : [[field, messages[0]] as [string, string]],
  );
}

/**
 * A refusal whose reason names one field (`EMAIL_TAKEN` → the e-mail): the field it belongs to and
 * the `sk.validation` key it is shown with, or null. Field errors stay under the field; only what
 * is not about one field becomes a toast.
 */
export function refusedField<F extends string>(
  error: unknown,
  fields: Partial<Record<string, readonly [field: F, key: keyof typeof sk.validation]>>,
): readonly [field: F, key: keyof typeof sk.validation] | null {
  const reason = errorReason(error);
  // Own keys only: a reason like `toString` must not find Object.prototype's.
  return reason !== undefined && Object.hasOwn(fields, reason) ? (fields[reason] ?? null) : null;
}

/** Puts them onto the form's fields. */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): void {
  for (const [field, message] of serverFieldErrors(error))
    setError(field as Path<T>, { type: 'server', message });
}
