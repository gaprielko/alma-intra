import {
  durationMs,
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

const SECRET = 'unit-test-access-secret-0123456789abcdef';

describe('auth tokens', () => {
  it('round-trips an access token', async () => {
    const token = await signAccessToken({ userId: 'u1', sessionId: 's1' }, SECRET, '15m');
    expect(await verifyAccessToken(token, SECRET)).toEqual({ userId: 'u1', sessionId: 's1' });
  });

  it('rejects a wrong secret, an expired token and garbage', async () => {
    const token = await signAccessToken({ userId: 'u1', sessionId: 's1' }, SECRET, '15m');
    expect(await verifyAccessToken(token, `${SECRET}x`)).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + durationMs('16m'));
    expect(await verifyAccessToken(token, SECRET)).toBeNull();
    vi.useRealTimers();

    expect(await verifyAccessToken('not-a-token', SECRET)).toBeNull();
  });

  it('rejects an unsigned token', async () => {
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${b64({ alg: 'none' })}.${b64({ sub: 'u1', sid: 's1', iss: 'alma-api' })}.`;
    expect(await verifyAccessToken(unsigned, SECRET)).toBeNull();
  });

  it('parses durations and hashes refresh tokens deterministically', () => {
    expect(durationMs('15m')).toBe(900_000);
    expect(durationMs('30d')).toBe(2_592_000_000);
    expect(() => durationMs('soon')).toThrow();

    const token = newRefreshToken();
    expect(token).not.toBe(newRefreshToken());
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toContain(token);
  });
});
