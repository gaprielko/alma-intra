import { describe, expect, it } from 'vitest';
import { formatPhone, phoneSchema } from './common.js';

describe('formatPhone', () => {
  it.each([
    ['0911115502', '+421 911 115 502'],
    ['0911 115 502', '+421 911 115 502'],
    ['+421911115502', '+421 911 115 502'],
    ['00421 911 115 502', '+421 911 115 502'],
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
    expect(phoneSchema.parse('0911115502')).toBe('+421 911 115 502');
  });
  it.each(['0911 115', '+421 911 115 5022', '911115502', '+1 23', 'abc'])('refuses %s', (typed) => {
    expect(phoneSchema.safeParse(typed).success).toBe(false);
  });
  it('accepts a foreign number with its country code', () => {
    expect(phoneSchema.parse('+420 602 123 456')).toBe('+420 602 123 456');
  });
});
