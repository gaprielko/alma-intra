import { describe, expect, it } from 'vitest';
import { countFromWorkloads, discountAt, priceOf, withoutVat, withVat } from './product.js';

describe('a discount in steps', () => {
  const steps = [
    { percent: 100, months: 3 },
    { percent: 50, months: 9 },
  ];

  it('takes each step in turn, then none', () => {
    expect([0, 2, 3, 11, 12].map((month) => discountAt(steps, month))).toEqual([
      100,
      100,
      50,
      50,
      null,
    ]);
  });

  it('a step without months lasts for good', () => {
    expect(discountAt([{ percent: 10, months: null }], 500)).toBe(10);
    expect(discountAt([], 0)).toBeNull();
  });
});

describe('product prices', () => {
  const list = {
    basePrice: 49,
    items: [
      { itemId: 'admin', included: 1, unitPrice: 10, billing: 'recurring' as const },
      { itemId: 'nurse', included: 4, unitPrice: 8, billing: 'recurring' as const },
      { itemId: 'setup', included: 0, unitPrice: 450, billing: 'once' as const },
    ],
  };

  it('adds each piece above the package, one-off items apart (R-4)', () => {
    expect(priceOf(list, { admin: 2, nurse: 10, setup: 1 })).toEqual({ recurring: 107, once: 450 });
    expect(priceOf(list, {})).toEqual({ recurring: 49, once: 0 });
  });

  it('computes one price from the other with VAT, to the cent (R-9)', () => {
    expect(withVat(49, 23)).toBe(60.27);
    expect(withVat(8, 23)).toBe(9.84);
    expect(withoutVat(9.84, 23)).toBe(8);
  });

  it('counts from workloads rounded up to the step, the sum up to whole ones (R-14, R-15)', () => {
    const w = (persons: number, percent: number) => ({ persons, percent });
    expect(countFromWorkloads([w(2, 100), w(3, 33), w(1, 15)], 50)).toEqual({
      percent: 400,
      count: 4,
    });
    expect(countFromWorkloads([w(1, 51)], 50)).toEqual({ percent: 100, count: 1 });
    expect(countFromWorkloads([w(9, 50)], 50)).toEqual({ percent: 450, count: 5 });
  });
});
