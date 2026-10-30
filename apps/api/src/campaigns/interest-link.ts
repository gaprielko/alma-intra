import { createHmac, timingSafeEqual } from 'node:crypto';
import { ACTIVITY_TYPE_INTEREST_ID } from '@intra/shared/schemas';
import type { Env } from '../config/env.js';

type Keys = Pick<Env, 'DATA_ENCRYPTION_KEY'>;

const signed = (env: Keys, payload: string) =>
  createHmac('sha256', env.DATA_ENCRYPTION_KEY).update(payload).digest('base64url').slice(0, 32);

/** What a token from before the types signs: only a message and a product. */
const signOld = (env: Keys, message: string, product: string) =>
  signed(env, `interest:${message}:${product}`);
const sign = (env: Keys, message: string, type: string, product: string) =>
  signed(env, `activity:${message}:${type}:${product}`);

/** A token's place for the product of a type that asks for none. */
const NO_PRODUCT = '0'.repeat(32);
const asHex = (id: string) => id.replaceAll('-', '');
const asUuid = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

export interface RecordedActivity {
  typeId: string;
  productId: string | null;
}

/**
 * The token of a button that records an activity: a sent message, the type and the product, signed
 * with a server key. Nothing is stored. It does not expire: a late answer is still an answer.
 */
export function activityToken(env: Keys, messageId: string, activity: RecordedActivity) {
  const message = asHex(messageId);
  const type = asHex(activity.typeId);
  const product = activity.productId ? asHex(activity.productId) : NO_PRODUCT;
  return `${message}.${type}.${product}.${sign(env, message, type, product)}`;
}

/** A token already in somebody's inbox, from before the types. Only tests make new ones. */
export function oldInterestToken(env: Keys, messageId: string, productId: string) {
  const message = asHex(messageId);
  const product = asHex(productId);
  return `${message}.${product}.${signOld(env, message, product)}`;
}

/** The public page's address: in the fragment, which a browser never sends to a server. */
export const activityUrl = (
  env: Keys & Pick<Env, 'WEB_URL'>,
  messageId: string,
  activity: RecordedActivity,
) => `${env.WEB_URL}/zaujem#${activityToken(env, messageId, activity)}`;

const same = (a: string, b: string) => timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The message, type and product of a token, or `null` when it is not one of ours. */
export function readActivityToken(env: Keys, token: string) {
  const old = /^([0-9a-f]{32})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (old) {
    const [, message, product, signature] = old as unknown as [string, string, string, string];
    if (!same(signOld(env, message, product), signature)) return null;
    return {
      messageId: asUuid(message),
      typeId: ACTIVITY_TYPE_INTEREST_ID,
      productId: asUuid(product),
    };
  }
  const match = /^([0-9a-f]{32})\.([0-9a-f]{32})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!match) return null;
  const [, message, type, product, signature] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!same(sign(env, message, type, product), signature)) return null;
  return {
    messageId: asUuid(message),
    typeId: asUuid(type),
    productId: product === NO_PRODUCT ? null : asUuid(product),
  };
}
