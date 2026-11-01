import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

type Holding = {
  organizationId: string;
  productId: string;
  active: boolean;
  holder: { id: string; isEstablishment: boolean };
  items: { itemId: string; count: number }[];
  price: { monthly: number; yearly: number; monthlyGross: number; discounting: boolean };
};

describe('a product at an organization or a prevádzka', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let org: string;
  let est: string;
  let product: string;
  let admin: string;
  let nurse: string;

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    const role = { kind: 'role', apps: ['web'] };
    admin = (
      await jana.call<{ id: string }>('product.itemCreate', { ...role, name: 'Admin prístup' })
    ).data.id;
    nurse = (await jana.call<{ id: string }>('product.itemCreate', { ...role, name: 'Sestra' }))
      .data.id;
    product = (
      await jana.call<{ id: string }>('product.create', {
        name: 'ADOS Holding',
        basePrice: 49,
        basePriceGross: null,
        period: 'month',
        active: true,
        workloadStep: 50,
        items: [
          {
            itemId: admin,
            included: 1,
            unitPrice: 10,
            unitPriceGross: null,
            max: 3,
            billing: 'recurring',
          },
          {
            itemId: nurse,
            included: 4,
            unitPrice: 8,
            unitPriceGross: null,
            max: 50,
            billing: 'recurring',
            byWorkload: true,
          },
        ],
      })
    ).data.id;
    org = (
      await jana.call<{ id: string }>('customer.create', {
        customer: {
          kind: 'organization',
          name: 'Holding ADOS, s.r.o.',
          role: 'customer',
          tags: [],
          productIds: [],
        },
      })
    ).data.id;
    est = (
      await jana.call<{ id: string }>('customer.establishmentCreate', {
        parentId: org,
        establishment: { name: 'Holding ADOS Poprad' },
      })
    ).data.id;
  });
  afterAll(async () => {
    await api.close();
  });

  const holding = (organizationId: string, extra: Record<string, unknown> = {}) => ({
    organizationId,
    productId: product,
    validFrom: '2026-11-01',
    validTo: null,
    pricing: 'list',
    discountSteps: [],
    fixedPrice: null,
    fixedPriceGross: null,
    counts: [{ itemId: admin, count: 2 }],
    workloads: [
      { itemId: nurse, persons: 2, percent: 100 },
      { itemId: nurse, persons: 3, percent: 33 },
      { itemId: nurse, persons: 1, percent: 15 },
    ],
    ...extra,
  });

  it('counts the nurses from workloads and prices the product by the list', async () => {
    expect((await jana.call('customer.holdingSave', holding(org))).code).toBeUndefined();
    const held = await jana.call<Holding[]>('customer.holdings', { id: org });
    expect(held.data).toHaveLength(1);
    expect(held.data[0]!.items.find((i) => i.itemId === nurse)!.count).toBe(4);
    // 49 + one admin above the package (10); the four nurses are in the package.
    expect(held.data[0]!.price).toMatchObject({ monthly: 59, yearly: 708, monthlyGross: 72.57 });
  });

  it('refuses a count below the package', async () => {
    const refused = await jana.call(
      'customer.holdingSave',
      holding(org, { counts: [{ itemId: admin, count: 0 }] }),
    );
    expect(refused.message).toBe('COUNT_OUT_OF_RANGE');
  });

  it('a discount lowers the price; the organization shows its prevádzka’s products too', async () => {
    await jana.call(
      'customer.holdingSave',
      holding(est, {
        pricing: 'discount',
        discountSteps: [{ percent: 10, months: null }],
        counts: [],
        workloads: [],
      }),
    );
    const held = await jana.call<Holding[]>('customer.holdings', { id: org });
    const atEst = held.data.find((h) => h.holder.isEstablishment)!;
    expect(atEst.price).toMatchObject({ monthly: 44.1, discounting: true });
    const detail = await jana.call<{ nurses: number | null; products: { id: string }[] }>(
      'customer.get',
      { id: org },
    );
    // 4 at the organization, 4 (the package) at the prevádzka.
    expect(detail.data.nurses).toBe(8);
  });

  it('a discount in steps: the current one applies, the list price after them', async () => {
    const monthsAgo = (months: number) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - months);
      return date.toISOString().slice(0, 10);
    };
    const priced = async (validFrom: string) => {
      await jana.call(
        'customer.holdingSave',
        holding(est, {
          validFrom,
          pricing: 'discount',
          discountSteps: [
            { percent: 100, months: 3 },
            { percent: 50, months: 9 },
          ],
          counts: [],
          workloads: [],
        }),
      );
      const held = await jana.call<Holding[]>('customer.holdings', { id: est });
      return held.data[0]!.price;
    };
    expect(await priced(monthsAgo(1))).toMatchObject({ monthly: 0, discounting: true });
    expect(await priced(monthsAgo(4))).toMatchObject({ monthly: 24.5, discounting: true });
    expect(await priced(monthsAgo(13))).toMatchObject({ monthly: 49, discounting: false });
    await jana.call(
      'customer.holdingSave',
      holding(est, {
        pricing: 'discount',
        discountSteps: [{ percent: 10, months: null }],
        counts: [],
        workloads: [],
      }),
    );
  });

  it('keeps the counts when the form ticks the products again', async () => {
    await jana.call('customer.update', {
      id: org,
      customer: {
        kind: 'organization',
        name: 'Holding ADOS, s.r.o.',
        role: 'customer',
        tags: [],
        productIds: [product],
      },
    });
    const held = await jana.call<Holding[]>('customer.holdings', { id: org });
    expect(held.data.find((h) => !h.holder.isEstablishment)!.items[0]!.count).toBe(2);
  });

  it('the form without products leaves them; „Ceny produktov“ holds for the prevádzka', async () => {
    await jana.call('customer.update', {
      id: org,
      customer: {
        kind: 'organization',
        name: 'Holding ADOS, s.r.o.',
        role: 'customer',
        tags: [],
        pricesWithVat: false,
      },
    });
    const held = await jana.call<Holding[]>('customer.holdings', { id: org });
    expect(held.data.filter((h) => !h.holder.isEstablishment)).toHaveLength(1);
    const own = await jana.call<{ pricesWithVat: boolean }>('customer.get', { id: org });
    const ofEst = await jana.call<{ pricesWithVat: boolean }>('customer.get', { id: est });
    expect(own.data.pricesWithVat).toBe(false);
    expect(ofEst.data.pricesWithVat).toBe(false);
  });

  it('a product held only by an organization in the trash can be removed', async () => {
    const copy = await jana.call<{ id: string }>('product.duplicate', { id: product });
    const gone = await jana.call<{ id: string }>('customer.create', {
      customer: {
        kind: 'organization',
        name: 'Holding do koša, s.r.o.',
        role: 'customer',
        tags: [],
        productIds: [],
      },
    });
    await jana.call(
      'customer.holdingSave',
      holding(gone.data.id, { productId: copy.data.id, counts: [], workloads: [] }),
    );
    const refused = await jana.call('product.delete', { id: copy.data.id });
    expect(refused.message).toBe('IN_USE');
    await jana.call('customer.delete', { id: gone.data.id });
    expect((await jana.call('product.delete', { id: copy.data.id })).code).toBeUndefined();
  });

  it('ends a product: it stays, no longer active', async () => {
    await jana.call('customer.holdingEnd', { organizationId: est, productId: product });
    const held = await jana.call<Holding[]>('customer.holdings', { id: est });
    expect(held.data[0]!.active).toBe(true);
    const holders = await jana.call<{ items: { id: string; monthly: number | null }[] }>(
      'product.holders',
      { id: product },
    );
    expect(holders.data.items.find((h) => h.id === org)!.monthly).toBe(59);
    const found = await jana.call<{ items: { id: string }[]; total: number }>('product.holders', {
      id: product,
      search: 'poprad',
    });
    expect(found.data).toMatchObject({ total: 1, items: [{ id: est }] });
    const none = await jana.call<{ total: number }>('product.holders', {
      id: product,
      search: 'nikto',
    });
    expect(none.data.total).toBe(0);
  });

  it('removes a product entered by mistake, with its counts', async () => {
    await jana.call('customer.holdingDelete', { organizationId: est, productId: product });
    const held = await jana.call<Holding[]>('customer.holdings', { id: est });
    expect(held.data.some((h) => h.productId === product && h.organizationId === est)).toBe(false);
    const again = await jana.call('customer.holdingDelete', {
      organizationId: est,
      productId: product,
    });
    expect(again.code).toBe('NOT_FOUND');
  });
});
