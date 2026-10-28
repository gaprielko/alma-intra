import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

type Options = {
  contactTypes: { id: string; name: string; systemKey: string | null }[];
  products: { id: string; name: string }[];
};
type Page = {
  items: { id: string; name: string; status: string | null; products: { name: string }[] }[];
  total: number;
  counts: Record<string, number>;
};

describe('contacts (customers)', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let options: Options;
  const typeOf = (key: 'customer' | 'Partner') =>
    options.contactTypes.find((t) =>
      key === 'customer' ? t.systemKey === 'customer' : t.name === key,
    )!.id;

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    options = (await jana.call<Options>('customer.options')).data;
  });
  afterAll(async () => {
    await api.close();
  });

  const organization = (name: string, extra: Record<string, unknown> = {}) => ({
    customer: {
      kind: 'organization',
      name,
      contactTypeId: typeOf('customer'),
      tags: [],
      productIds: [],
      ...extra,
    },
  });

  it('creates an organization and refuses a second one with the same IČO', async () => {
    const first = await jana.call<{ id: string }>(
      'customer.create',
      organization('Test Rovnaké IČO, s.r.o.', { ico: '12 345 679' }),
    );
    expect(first.code).toBeUndefined();
    const second = await jana.call(
      'customer.create',
      organization('Iná firma', { ico: '12345679' }),
    );
    expect(second.code).toBe('CONFLICT');
    expect(second.message).toBe('ICO_TAKEN');
  });

  it('keeps a status only for the type „Zákazník“', async () => {
    const partner = await jana.call<{ id: string }>(
      'customer.create',
      organization('Partner bez stavu', { contactTypeId: typeOf('Partner'), status: 'interested' }),
    );
    const got = await jana.call<{ status: string | null }>('customer.get', { id: partner.data.id });
    expect(got.data.status).toBeNull();
  });

  it('lists with products, filters by product and counts by status', async () => {
    const ados = options.products.find((p) => p.name === 'ADOS')!;
    const page = await jana.call<Page>('customer.list', { productId: ados.id, pageSize: 100 });
    expect(page.data.total).toBeGreaterThan(0);
    expect(page.data.items.every((c) => c.products.some((p) => p.name === 'ADOS'))).toBe(true);
    const sum = Object.entries(page.data.counts)
      .filter(([key]) => key !== 'all')
      .reduce((n, [, count]) => n + count, 0);
    expect(sum).toBe(page.data.counts.all);
  });

  it('records changes with ids and names them in the history', async () => {
    const made = await jana.call<{ id: string }>('customer.create', organization('História, a.s.'));
    const ados = options.products.find((p) => p.name === 'ADOS')!;
    await jana.call('customer.update', {
      id: made.data.id,
      ...organization('História, a.s.', { tags: ['pilot test'], productIds: [ados.id] }),
    });
    const history = await jana.call<
      { action: string; diff: Record<string, unknown> | null; names: Record<string, string> }[]
    >('customer.history', { id: made.data.id });
    const update = history.data.find((e) => e.action === 'customer.update')!;
    const added = update.diff!.tagsAdded as string[];
    expect(added).toHaveLength(1);
    expect(update.names[added[0]!]).toBe('pilot test');
    expect(update.names[(update.diff!.productsAdded as string[])[0]!]).toBe('ADOS');
  });

  it('refuses a second contact person with the same e-mail at one organization', async () => {
    const org = await jana.call<{ id: string }>('customer.create', organization('Osoby, s.r.o.'));
    const person = { firstName: 'Eva', lastName: 'Nová', email: 'eva.nova@example.org' };
    expect(
      (await jana.call('customer.contactCreate', { customerId: org.data.id, contact: person }))
        .code,
    ).toBeUndefined();
    const again = await jana.call('customer.contactCreate', {
      customerId: org.data.id,
      contact: person,
    });
    expect(again.message).toBe('CONTACT_EMAIL_TAKEN');
  });

  it('exports CSV with formulas defused', async () => {
    await jana.call('customer.create', organization('=HYPERLINK("x")'));
    const out = await jana.call<{ csv: string; count: number }>('customer.exportCsv', {
      search: 'HYPERLINK',
    });
    expect(out.data.count).toBe(1);
    expect(out.data.csv).not.toMatch(/(^|;)"?=HYPERLINK/m);
  });

  it('deletes softly: gone from the list, the detail says so', async () => {
    const made = await jana.call<{ id: string }>('customer.create', organization('Na zmazanie'));
    await jana.call('customer.delete', { id: made.data.id });
    expect((await jana.call('customer.get', { id: made.data.id })).code).toBe('NOT_FOUND');
    const page = await jana.call<Page>('customer.list', { search: 'Na zmazanie' });
    expect(page.data.total).toBe(0);
  });
});
