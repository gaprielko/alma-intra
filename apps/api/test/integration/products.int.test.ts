import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

type Product = {
  id: string;
  name: string;
  basePrice: number | null;
  basePriceGross: number | null;
  active: boolean;
  customers: number;
  items: {
    itemId: string;
    name: string;
    included: number;
    unitPrice: number | null;
    unitPriceGross: number | null;
    max: number | null;
    billing: string;
    byWorkload: boolean;
  }[];
};

describe('products and their price lists', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let admin: string;
  let nurse: string;
  let product: string;

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
  });
  afterAll(async () => {
    await api.close();
  });

  const priceList = () => [
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
      unitPrice: null,
      unitPriceGross: 9.84,
      max: 50,
      billing: 'recurring',
      byWorkload: true,
    },
  ];

  it('keeps the item names in one shared catalog, each name once', async () => {
    admin = (
      await jana.call<{ id: string }>('product.itemCreate', {
        name: 'Admin prístup',
        unit: 'prístup',
      })
    ).data.id;
    nurse = (
      await jana.call<{ id: string }>('product.itemCreate', { name: 'Sestra', unit: 'sestra' })
    ).data.id;
    const twice = await jana.call('product.itemCreate', { name: 'sestra' });
    expect(twice.message).toBe('NAME_TAKEN');
  });

  it('creates a product with its price list; the missing price is computed with VAT, to the cent', async () => {
    const created = await jana.call<{ id: string }>('product.create', {
      name: 'ADOS Test',
      basePrice: 49,
      basePriceGross: null,
      period: 'month',
      active: true,
      workloadStep: 50,
      items: priceList(),
    });
    expect(created.code).toBeUndefined();
    product = created.data.id;
    const got = await jana.call<Product>('product.get', { id: product });
    expect(got.data).toMatchObject({ basePrice: 49, basePriceGross: 60.27 });
    expect(
      got.data.items.map((i) => [i.name, i.unitPrice, i.unitPriceGross, i.byWorkload]),
    ).toEqual([
      ['Admin prístup', 10, 12.3, false],
      ['Sestra', 8, 9.84, true],
    ]);
  });

  it('refuses an item twice in one price list', async () => {
    const refused = await jana.call('product.update', {
      id: product,
      product: {
        name: 'ADOS Test',
        basePrice: 49,
        basePriceGross: 60.27,
        period: 'month',
        active: true,
        workloadStep: 50,
        items: [...priceList(), priceList()[0]],
      },
    });
    expect(refused.message).toBe('ITEM_TWICE');
  });

  it('duplicates a product under „(kópia)“', async () => {
    const copy = await jana.call<{ id: string }>('product.duplicate', { id: product });
    const got = await jana.call<Product>('product.get', { id: copy.data.id });
    expect(got.data.name).toBe('ADOS Test (kópia)');
    expect(got.data.items).toHaveLength(2);
    await jana.call('product.delete', { id: copy.data.id });
  });

  it('a new VAT rate keeps the prices without VAT and computes those with it again', async () => {
    await jana.call('product.setVatRate', { vatRate: 20 });
    const got = await jana.call<Product>('product.get', { id: product });
    expect(got.data).toMatchObject({ basePrice: 49, basePriceGross: 58.8 });
    expect(got.data.items[1]).toMatchObject({ unitPrice: 8, unitPriceGross: 9.6 });
    await jana.call('product.setVatRate', { vatRate: 23 });
    expect((await jana.call<{ vatRate: number }>('product.vatRate')).data.vatRate).toBe(23);
  });

  it('keeps a product somebody holds, and an item a price list uses', async () => {
    const list = await jana.call<Product[]>('product.list');
    const held = list.data.find((p) => p.customers > 0)!;
    expect((await jana.call('product.delete', { id: held.id })).message).toBe('IN_USE');
    expect((await jana.call('product.itemDelete', { id: nurse })).message).toBe('IN_USE');
  });

  it('lists the items with the products that use them', async () => {
    const items =
      await jana.call<{ id: string; usedIn: { product: string; included: number }[] }[]>(
        'product.items',
      );
    expect(items.data.find((i) => i.id === nurse)!.usedIn).toEqual([
      expect.objectContaining({ product: 'ADOS Test', included: 4 }),
    ]);
  });
});
