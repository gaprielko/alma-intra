import { downloadToken, readDownloadToken } from './download-link.js';

const ENV = { DATA_ENCRYPTION_KEY: 'unit-test-encryption-key-0123456789abcdef' };
const VERSION = '0f6e2a9c-1b2d-4e3f-8a4b-5c6d7e8f9a0b';

describe('download links (D-26)', () => {
  it('opens its own file version until it expires', () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    const token = downloadToken(ENV, VERSION, expiresAt);
    expect(readDownloadToken(ENV, token)).toEqual({ fileVersionId: VERSION });
    expect(readDownloadToken(ENV, token, new Date(expiresAt.getTime() + 1000))).toBe('expired');
  });

  it('refuses a changed version, a later expiry, another key and garbage', () => {
    const token = downloadToken(ENV, VERSION, new Date(Date.now() + 86_400_000));
    const [id, expires, signature] = token.split('.') as [string, string, string];
    const otherId = `${id.slice(0, -1)}${id.endsWith('0') ? '1' : '0'}`;
    expect(readDownloadToken(ENV, `${otherId}.${expires}.${signature}`)).toBe('invalid');
    expect(readDownloadToken(ENV, `${id}.zzzzzz.${signature}`)).toBe('invalid');
    expect(readDownloadToken({ DATA_ENCRYPTION_KEY: `${ENV.DATA_ENCRYPTION_KEY}x` }, token)).toBe(
      'invalid',
    );
    expect(readDownloadToken(ENV, 'not-a-token')).toBe('invalid');
  });
});
