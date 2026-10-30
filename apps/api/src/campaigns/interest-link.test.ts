import { ACTIVITY_TYPE_INTEREST_ID } from '@intra/shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  activityToken,
  activityUrl,
  oldInterestToken,
  readActivityToken,
} from './interest-link.js';

const ENV = { DATA_ENCRYPTION_KEY: 'k'.repeat(44), WEB_URL: 'https://intra.test' };
const MESSAGE = '00000000-0000-4000-8000-000000000001';
const TYPE = '00000000-0000-4000-8000-000000000002';
const PRODUCT = '00000000-0000-4000-8000-0000000000a1';
const ACTIVITY = { typeId: TYPE, productId: PRODUCT };

describe('the token of a button that records an activity', () => {
  it('gives back its message, type and product', () => {
    expect(readActivityToken(ENV, activityToken(ENV, MESSAGE, ACTIVITY))).toEqual({
      messageId: MESSAGE,
      ...ACTIVITY,
    });
  });

  it('works for a type without a product', () => {
    const token = activityToken(ENV, MESSAGE, { typeId: TYPE, productId: null });
    expect(readActivityToken(ENV, token)?.productId).toBeNull();
  });

  it('reads a token from before the types as interest in its product', () => {
    expect(readActivityToken(ENV, oldInterestToken(ENV, MESSAGE, PRODUCT))).toEqual({
      messageId: MESSAGE,
      typeId: ACTIVITY_TYPE_INTEREST_ID,
      productId: PRODUCT,
    });
  });

  it('travels in the fragment of the link', () => {
    expect(activityUrl(ENV, MESSAGE, ACTIVITY)).toBe(
      `https://intra.test/zaujem#${activityToken(ENV, MESSAGE, ACTIVITY)}`,
    );
  });

  it('is refused when changed, made with another key or not a token at all', () => {
    const token = activityToken(ENV, MESSAGE, ACTIVITY);
    const other = activityToken(ENV, MESSAGE, { typeId: MESSAGE, productId: PRODUCT });
    expect(readActivityToken(ENV, `${other.slice(0, 66)}${token.slice(66)}`)).toBeNull();
    expect(readActivityToken({ DATA_ENCRYPTION_KEY: 'x'.repeat(44) }, token)).toBeNull();
    expect(readActivityToken(ENV, 'nonsense')).toBeNull();
  });
});
