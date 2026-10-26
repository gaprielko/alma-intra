import { isReservedAddress } from './reserved-domain.js';

describe('reserved mail domains (RFC 2606 / 6761, ALMA-212)', () => {
  it.each([
    'eva@example.com',
    'eva@example.org',
    'eva@example.net',
    'user@EXAMPLE.COM',
    'a@sub.example.org',
    'a@deep.sub.example.net',
    'eva@example.com.',
    'nurse@ados.test',
    'nurse@alma.example',
    'nurse@nowhere.invalid',
    'dev@localhost',
    'dev@api.LOCALHOST',
  ])('skips %s', (address) => {
    expect(isReservedAddress(address)).toBe(true);
  });

  it.each([
    'user@notexample.com',
    'user@example.com.sk',
    'user@example.co',
    'user@myexample.org',
    'user@test.sk',
    'user@example.sk',
    'user@localhost.sk',
    'pavol@gmail.com',
    'no-at-sign',
  ])('sends to %s', (address) => {
    expect(isReservedAddress(address)).toBe(false);
  });
});
