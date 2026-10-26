import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  totpAt,
  totpStep,
} from './totp.js';

// RFC 6238 Appendix B and RFC 4226 Appendix D: the SHA-1 seed is the ASCII string below.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('base32 (RFC 4648 §10)', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('%j encodes to %j and back', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(plain);
  });

  it('forgives case, spaces and padding, and refuses anything else', () => {
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow();
  });

  it('makes a 32-character secret of 160 bits', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(secret);
  });
});

describe('HOTP (RFC 4226 Appendix D)', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ])('counter %i is %s', (counter, code) => {
    expect(hotp(RFC_SECRET, counter)).toBe(code);
  });
});

describe('TOTP (RFC 6238 Appendix B, SHA-1, 8 digits)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('at %i s it is %s', (seconds, code) => {
    expect(totpAt(RFC_SECRET, seconds * 1000, 8)).toBe(code);
  });

  it('is the last six of those digits at the default length', () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1111111109_000)).toBe('081804');
  });
});

describe('matchTotp', () => {
  const now = 1111111111_000; // step 37037037
  const step = totpStep(now);
  const code = (s: number) => hotp(RFC_SECRET, s);

  it('accepts the current step and one either side, and answers which', () => {
    expect(matchTotp(RFC_SECRET, code(step), now, null)).toBe(step);
    expect(matchTotp(RFC_SECRET, code(step - 1), now, null)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, code(step + 1), now, null)).toBe(step + 1);
  });

  it('refuses two steps away, a wrong code and anything but six digits', () => {
    expect(matchTotp(RFC_SECRET, code(step - 2), now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, code(step + 2), now, null)).toBeNull();
    const wrong = String((Number(code(step)) + 1) % 1_000_000).padStart(6, '0');
    expect(matchTotp(RFC_SECRET, wrong, now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, `${code(step)}0`, now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, ' 12345', now, null)).toBeNull();
  });

  it('refuses a step already used, and every step before it', () => {
    expect(matchTotp(RFC_SECRET, code(step), now, step)).toBeNull();
    expect(matchTotp(RFC_SECRET, code(step - 1), now, step)).toBeNull();
    expect(matchTotp(RFC_SECRET, code(step + 1), now, step)).toBe(step + 1);
  });
});

describe('otpauthUri', () => {
  it('names the service and the account and spells out the parameters', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'eva@example.com', 'Alma');
    expect(uri).toBe(
      'otpauth://totp/Alma%3Aeva%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Alma&algorithm=SHA1&digits=6&period=30',
    );
  });
});
