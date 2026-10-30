import { interestToken, interestUrl, readInterestToken } from './interest-link.js';

const ENV = { DATA_ENCRYPTION_KEY: 'k'.repeat(44), WEB_URL: 'https://intra.test' };
const MESSAGE = '00000000-0000-4000-8000-000000000001';
const PRODUCT = '00000000-0000-4000-8000-0000000000a1';

describe('the token of an interest button', () => {
  it('gives back its message and product', () => {
    expect(readInterestToken(ENV, interestToken(ENV, MESSAGE, PRODUCT))).toEqual({
      messageId: MESSAGE,
      productId: PRODUCT,
    });
  });

  it('travels in the fragment of the link', () => {
    expect(interestUrl(ENV, MESSAGE, PRODUCT)).toBe(
      `https://intra.test/zaujem#${interestToken(ENV, MESSAGE, PRODUCT)}`,
    );
  });

  it('is refused when changed, made with another key or not a token at all', () => {
    const token = interestToken(ENV, MESSAGE, PRODUCT);
    const other = interestToken(ENV, MESSAGE, MESSAGE);
    expect(readInterestToken(ENV, `${other.slice(0, 66)}${token.slice(66)}`)).toBeNull();
    expect(readInterestToken({ DATA_ENCRYPTION_KEY: 'x'.repeat(44) }, token)).toBeNull();
    expect(readInterestToken(ENV, 'nonsense')).toBeNull();
  });
});
