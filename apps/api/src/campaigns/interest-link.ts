import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';

type Keys = Pick<Env, 'DATA_ENCRYPTION_KEY'>;

const sign = (env: Keys, message: string, product: string) =>
  createHmac('sha256', env.DATA_ENCRYPTION_KEY)
    .update(`interest:${message}:${product}`)
    .digest('base64url')
    .slice(0, 32);

const asHex = (id: string) => id.replaceAll('-', '');
const asUuid = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/**
 * The token of a button that records interest: a sent message and a product, signed with a server
 * key. Nothing is stored. It does not expire: a late interest is still interest.
 */
export function interestToken(env: Keys, messageId: string, productId: string) {
  const message = asHex(messageId);
  const product = asHex(productId);
  return `${message}.${product}.${sign(env, message, product)}`;
}

/** The public page's address: in the fragment, which a browser never sends to a server. */
export const interestUrl = (
  env: Keys & Pick<Env, 'WEB_URL'>,
  messageId: string,
  productId: string,
) => `${env.WEB_URL}/zaujem#${interestToken(env, messageId, productId)}`;

/** The message and the product of a token, or `null` when it is not one of ours. */
export function readInterestToken(env: Keys, token: string) {
  const match = /^([0-9a-f]{32})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!match) return null;
  const [, message, product, signature] = match as unknown as [string, string, string, string];
  if (!timingSafeEqual(Buffer.from(sign(env, message, product)), Buffer.from(signature))) {
    return null;
  }
  return { messageId: asUuid(message), productId: asUuid(product) };
}
