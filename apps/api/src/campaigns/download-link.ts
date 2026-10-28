import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';

/** How long a download link in a sent e-mail works (D-26). */
export const DOWNLOAD_LINK_DAYS = 30;

const sign = (env: Pick<Env, 'DATA_ENCRYPTION_KEY'>, id: string, expires: string) =>
  createHmac('sha256', env.DATA_ENCRYPTION_KEY)
    .update(`download:${id}:${expires}`)
    .digest('base64url')
    .slice(0, 32);

/**
 * The token of `/d/<token>`: a file version and when the link stops working, signed with a
 * server key. Nothing is stored; the token travels in the path because a recipient's mail client
 * opens it with a plain GET.
 */
export function downloadToken(
  env: Pick<Env, 'DATA_ENCRYPTION_KEY'>,
  fileVersionId: string,
  expiresAt: Date,
) {
  const id = fileVersionId.replaceAll('-', '');
  const expires = Math.floor(expiresAt.getTime() / 1000).toString(36);
  return `${id}.${expires}.${sign(env, id, expires)}`;
}

/** The file version of a token, or why it does not open one. */
export function readDownloadToken(
  env: Pick<Env, 'DATA_ENCRYPTION_KEY'>,
  token: string,
  now = new Date(),
): { fileVersionId: string } | 'invalid' | 'expired' {
  const match = /^([0-9a-f]{32})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!match) return 'invalid';
  const [, id, expires, signature] = match as unknown as [string, string, string, string];
  const expected = Buffer.from(sign(env, id, expires));
  if (!timingSafeEqual(expected, Buffer.from(signature))) return 'invalid';
  if (parseInt(expires, 36) * 1000 < now.getTime()) return 'expired';
  return {
    fileVersionId: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
  };
}
