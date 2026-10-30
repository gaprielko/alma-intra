import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAlmaSignature } from './ados-feedback.js';

const SECRET = 's'.repeat(40);
const NOW = 1_793_294_400;
const BODY = Buffer.from('{"id":"é"}');
const sign = (timestamp: number, body: Buffer = BODY, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
const check = (timestamp: string | undefined, signature: string | undefined, body = BODY) =>
  verifyAlmaSignature(SECRET, { timestamp, signature }, body, NOW);

describe('the signature of a request from Alma ADOS', () => {
  it('holds for the exact bytes within five minutes, either way', () => {
    expect(check(String(NOW), sign(NOW))).toBe(true);
    expect(check(String(NOW - 300), sign(NOW - 300))).toBe(true);
    expect(check(String(NOW + 300), sign(NOW + 300))).toBe(true);
  });

  it('refuses an old or a future timestamp', () => {
    expect(check(String(NOW - 301), sign(NOW - 301))).toBe(false);
    expect(check(String(NOW + 301), sign(NOW + 301))).toBe(false);
  });

  it('refuses other bytes, another secret and a timestamp it did not sign', () => {
    expect(check(String(NOW), sign(NOW), Buffer.from('{"id":"e"}'))).toBe(false);
    expect(check(String(NOW), sign(NOW, BODY, 'x'.repeat(40)))).toBe(false);
    expect(check(String(NOW + 1), sign(NOW))).toBe(false);
  });

  it('refuses a missing or malformed header', () => {
    expect(check(undefined, sign(NOW))).toBe(false);
    expect(check(String(NOW), undefined)).toBe(false);
    expect(check('soon', sign(NOW))).toBe(false);
    expect(check(String(NOW), 'sha256=ABC')).toBe(false);
  });
});
