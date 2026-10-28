import { sk } from '@intra/shared/i18n';
import { TRPCClientError } from '@trpc/client';
import { errorCode, errorMessage, errorReason } from './errors';

/** A refusal as the tRPC client hands it over: the reason as message, the code in its data. */
const refusal = (message: string, code: string) =>
  new TRPCClientError(message, { result: { error: { data: { code } } } });

describe('errorMessage', () => {
  it('prefers the screen’s words for the reason, then for the code, then the shared ones', () => {
    const taken = refusal('ICO_TAKEN', 'CONFLICT');
    expect(errorMessage(taken, { ICO_TAKEN: 'IČO už existuje.' })).toBe('IČO už existuje.');
    expect(errorMessage(taken, { CONFLICT: 'Konflikt.' })).toBe('Konflikt.');
    expect(errorMessage(refusal('x', 'NOT_FOUND'))).toBe(sk.errors.NOT_FOUND);
  });

  it('falls back for anything that is not a refusal of the API', () => {
    expect(errorMessage(new Error('boom'))).toBe(sk.errors.generic);
    expect(errorMessage(refusal('x', 'INTERNAL_SERVER_ERROR'), {}, 'Iné.')).toBe('Iné.');
  });

  it('reads the reason and the code', () => {
    const taken = refusal('ICO_TAKEN', 'CONFLICT');
    expect(errorReason(taken)).toBe('ICO_TAKEN');
    expect(errorCode(taken)).toBe('CONFLICT');
    expect(errorCode(new Error('x'))).toBeUndefined();
  });
});
