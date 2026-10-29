import { describe, expect, it } from 'vitest';
import { formatPhone, phoneSchema } from './common.js';

describe('formatPhone', () => {
  it.each([
    ['0912345678', '+421 912 345 678'],
    ['0912 345 678', '+421 912 345 678'],
    ['+421912345678', '+421 912 345 678'],
    ['00421 912 345 678', '+421 912 345 678'],
    ['+421 55 622 1100', '+421 556 221 100'],
    ['+42191', '+421 91'],
    ['+42', '+42'],
    ['+420  602 123 456', '+420 602 123 456'],
    ['', ''],
  ])('%s → %s', (typed, shaped) => {
    expect(formatPhone(typed)).toBe(shaped);
  });
});

describe('phoneSchema', () => {
  it('stores a Slovak number in one shape', () => {
    expect(phoneSchema.parse('0912345678')).toBe('+421 912 345 678');
  });
  it.each(['0912 345', '+421 912 345 6782', '912345678', '+1 23', 'abc'])('refuses %s', (typed) => {
    expect(phoneSchema.safeParse(typed).success).toBe(false);
  });
  it('accepts a foreign number with its country code', () => {
    expect(phoneSchema.parse('+420 602 123 456')).toBe('+420 602 123 456');
  });
});
