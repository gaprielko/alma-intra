import { describe, expect, it } from 'vitest';
import { formatDateText, parseDateText } from './field-input';

describe('dates in a field', () => {
  it('writes them without spaces', () => {
    expect(formatDateText('2026-10-29')).toBe('29.10.2026');
    expect(formatDateText('2027-03-01')).toBe('1.3.2027');
    expect(formatDateText('')).toBe('');
  });

  it('reads what people type', () => {
    expect(parseDateText('29.10.2026')).toBe('2026-10-29');
    expect(parseDateText('29. 10. 2026')).toBe('2026-10-29');
    expect(parseDateText('1.3.27')).toBe('2027-03-01');
    expect(parseDateText('2026-10-29')).toBe('2026-10-29');
  });

  it('refuses a date that does not exist', () => {
    expect(parseDateText('31.2.2026')).toBeNull();
    expect(parseDateText('29.10')).toBeNull();
    expect(parseDateText('včera')).toBeNull();
  });
});
