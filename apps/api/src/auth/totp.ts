import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * RFC 6238 TOTP, with nothing but `node:crypto`: HMAC-SHA1, 30-second steps, 6 digits,
 * one step of tolerance either way for a phone whose clock drifts. Pure functions, tested against
 * the RFC's own vectors (`totp.test.ts`). What is stored, when a step counts as used and who may
 * ask lives in `second-factor.service.ts`.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted before and after the current one. */
export const TOTP_WINDOW = 1;
/** 160 bits, the HMAC-SHA1 block the RFC recommends; 32 characters of base32. */
export const TOTP_SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding: what authenticator apps expect in an `otpauth://` URI. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * The inverse of `base32Encode`. Case, spaces and padding are forgiven (a secret typed by hand is
 * grouped and lower-cased); any other character throws.
 */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** RFC 4226 HOTP: dynamic truncation of HMAC-SHA1(secret, counter), `digits` long. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The step a moment falls into (T in RFC 6238, with T0 = 0). */
export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

export function totpAt(secret: Uint8Array, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(nowMs), digits);
}

/**
 * The step whose code `code` is, looked for from one step before now to one after; `null` when it
 * is none of them. Only steps later than `lastUsedStep` count: a code that was accepted once is
 * never accepted again, nor is any older one (replay within the window, RFC 6238 §5.2).
 * Every candidate is compared in constant time, and all of them are computed.
 */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(nowMs);
  let found: number | null = null;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    const same = timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code));
    if (same && found === null && (lastUsedStep === null || step > lastUsedStep)) found = step;
  }
  return found;
}

/**
 * `otpauth://totp/…` for the QR code (Key Uri Format). The label names the service and the
 * account, so the app lists it as „Alma: eva@…“; the parameters are the defaults spelled out,
 * because some apps do not assume them.
 */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
