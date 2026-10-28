import { createHmac } from 'node:crypto';

/** The seed's second factor (apps/api/src/db/seed.ts), dev only. */
export const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
export const SEED_PASSWORD = 'Alma-intra-2026';
export const JANA = 'jana.horvathova@example.com';

function base32(text: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of text.replace(/=+$/, ''))
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/** The current six-digit code of a base32 secret (RFC 6238, 30 s, SHA-1). */
export function totp(secret: string, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}
