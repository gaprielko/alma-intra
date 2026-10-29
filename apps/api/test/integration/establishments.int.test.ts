import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

const HARMONIA = '00000000-0000-4000-8000-d00000000001';
const EVA = '00000000-0000-4000-8000-e00000000010';

type Establishment = {
  id: string;
  name: string;
  city: string | null;
  primaryContact: { id: string; name: string } | null;
  persons: number;
};
type Person = {
  id: string;
  isPrimary: boolean;
  atOrganization: boolean;
  establishments: { id: string; name: string; position: string | null; isPrimary: boolean }[];
};

describe('prevádzky (establishments)', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let presov: string;

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
  });
  afterAll(async () => {
    await api.close();
  });

  const establishment = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    street: 'Hlavná 5',
    postalCode: '080 01',
    city: 'Prešov',
    ...extra,
  });

  it('adds a prevádzka with a person of the organization as its primary contact', async () => {
    const created = await jana.call<{ id: string }>('customer.establishmentCreate', {
      parentId: HARMONIA,
      establishment: establishment('ADOS Harmónia Prešov'),
      primary: { kind: 'existing', contactId: EVA, position: 'vedúca prevádzky' },
    });
    expect(created.code).toBeUndefined();
    presov = created.data.id;
    const list = await jana.call<Establishment[]>('customer.establishments', { id: HARMONIA });
    expect(list.data).toEqual([
      expect.objectContaining({
        id: presov,
        name: 'ADOS Harmónia Prešov',
        city: 'Prešov',
        persons: 1,
        primaryContact: expect.objectContaining({ id: EVA }) as unknown,
      }),
    ]);
  });

  it('keeps prevádzky out of the lists; a prevádzka shows its organization', async () => {
    const page = await jana.call<{ items: { id: string }[] }>('customer.list', {
      search: 'Harmónia',
    });
    expect(page.data.items.map((i) => i.id)).toEqual([HARMONIA]);
    const detail = await jana.call<{
      parentId: string;
      role: string;
      parent: { id: string; ico: string | null };
    }>('customer.get', { id: presov });
    expect(detail.data.parent).toMatchObject({ id: HARMONIA });
    expect(detail.data.role).toBe('customer');
    const parent = await jana.call<{ establishmentCount: number }>('customer.get', {
      id: HARMONIA,
    });
    expect(parent.data.establishmentCount).toBe(1);
  });

  it('lists the persons of the organization and its prevádzky, each with where they are', async () => {
    const persons = await jana.call<Person[]>('customer.persons', { id: HARMONIA });
    const eva = persons.data.find((p) => p.id === EVA)!;
    expect(eva).toMatchObject({ atOrganization: true, isPrimary: true });
    expect(eva.establishments).toEqual([
      { id: presov, name: 'ADOS Harmónia Prešov', position: 'vedúca prevádzky', isPrimary: true },
    ]);
    // The organization's primary contact comes first.
    expect(persons.data[0]!.id).toBe(EVA);
  });

  it('adds a new person straight to a prevádzka', async () => {
    const created = await jana.call<{ id: string }>('customer.establishmentCreate', {
      parentId: HARMONIA,
      establishment: establishment('ADOS Harmónia Košice – Terasa', { city: 'Košice' }),
      primary: {
        kind: 'new',
        contact: { firstName: 'Jana', lastName: 'Terasová', position: 'vedúca sestra' },
      },
    });
    const persons = await jana.call<Person[]>('customer.persons', { id: HARMONIA });
    const jt = persons.data.find((p) => p.establishments.some((e) => e.id === created.data.id))!;
    expect(jt).toMatchObject({ atOrganization: false, isPrimary: false });
  });

  it('refuses a prevádzka of a prevádzka', async () => {
    const refused = await jana.call('customer.establishmentCreate', {
      parentId: presov,
      establishment: establishment('Podprevádzka'),
    });
    expect(refused.code).toBe('BAD_REQUEST');
    expect(refused.message).toBe('NOT_PARENT');
  });

  it('edits a prevádzka with its own form only', async () => {
    const updated = await jana.call('customer.establishmentUpdate', {
      id: presov,
      establishment: establishment('ADOS Harmónia Prešov', { phone: '+421 51 772 3040' }),
    });
    expect(updated.code).toBeUndefined();
    const refused = await jana.call('customer.update', {
      id: presov,
      customer: { kind: 'organization', name: 'Iné', role: 'customer', tags: [], productIds: [] },
    });
    expect(refused.message).toBe('IS_ESTABLISHMENT');
    const notOne = await jana.call('customer.establishmentUpdate', {
      id: HARMONIA,
      establishment: establishment('Nie'),
    });
    expect(notOne.message).toBe('NOT_ESTABLISHMENT');
  });

  it('a prevádzka follows its organization’s role, and goes with it when deleted', async () => {
    const org = await jana.call<{ id: string }>('customer.create', {
      customer: {
        kind: 'organization',
        name: 'Sieť ADOS, n.o.',
        role: 'customer',
        tags: [],
        productIds: [],
      },
    });
    const est = await jana.call<{ id: string }>('customer.establishmentCreate', {
      parentId: org.data.id,
      establishment: establishment('Sieť ADOS Poprad', { city: 'Poprad' }),
    });
    expect(
      (await jana.call('customer.setRole', { id: est.data.id, role: 'partner' })).message,
    ).toBe('IS_ESTABLISHMENT');
    await jana.call('customer.setRole', { id: org.data.id, role: 'partner' });
    const turned = await jana.call<{ role: string }>('customer.get', { id: est.data.id });
    expect(turned.data.role).toBe('partner');
    await jana.call('customer.delete', { id: org.data.id });
    expect((await jana.call('customer.get', { id: est.data.id })).code).toBe('NOT_FOUND');
  });

  it('the list finds an organization by its prevádzka, and its region', async () => {
    type Page = {
      items: { id: string; establishmentCount: number; foundEstablishment: string | null }[];
    };
    const org = await jana.call<{ id: string }>('customer.create', {
      customer: {
        kind: 'organization',
        name: 'Sieť Tatry, s.r.o.',
        role: 'customer',
        region: 'zilina',
        tags: [],
        productIds: [],
      },
    });
    await jana.call('customer.establishmentCreate', {
      parentId: org.data.id,
      establishment: establishment('Tatry Kežmarok', { city: 'Kežmarok', region: 'presov' }),
    });
    const found = await jana.call<Page>('customer.list', { search: 'Kezmarok', pageSize: 100 });
    expect(found.data.items).toEqual([
      expect.objectContaining({
        id: org.data.id,
        establishmentCount: 1,
        foundEstablishment: 'Tatry Kežmarok',
      }),
    ]);
    const presov = await jana.call<Page>('customer.list', { region: ['presov'], pageSize: 100 });
    expect(presov.data.items.some((i) => i.id === org.data.id)).toBe(true);
    const nitra = await jana.call<Page>('customer.list', { region: ['nitra'], pageSize: 100 });
    expect(nitra.data.items.some((i) => i.id === org.data.id)).toBe(false);
    const csv = await jana.call<{ csv: string }>('customer.exportCsv', { ids: [org.data.id] });
    expect(csv.data.csv).toContain(';Prevádzky;');
    expect(csv.data.csv).toContain(';Tatry Kežmarok;');
  });

  it('removing a prevádzka is told in its organization’s history', async () => {
    const est = await jana.call<{ id: string }>('customer.establishmentCreate', {
      parentId: HARMONIA,
      establishment: establishment('Dočasná prevádzka'),
    });
    await jana.call('customer.delete', { id: est.data.id });
    const history = await jana.call<
      { diff: Record<string, unknown> | null; names: Record<string, string> }[]
    >('customer.history', { id: HARMONIA });
    const removed = history.data.find((e) => e.diff?.establishment === 'deleted')!;
    expect(removed.names[est.data.id]).toBe('Dočasná prevádzka');
  });
});
