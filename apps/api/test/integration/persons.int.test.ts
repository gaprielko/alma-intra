import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

const HARMONIA = '00000000-0000-4000-8000-d00000000001';
/** Mária Kováčová, a private-person customer, and her person. */
const KOVACOVA = '00000000-0000-4000-8000-d00000000004';
const EVA = '00000000-0000-4000-8000-e00000000010';

type Person = {
  id: string;
  name: string;
  organizations: { id: string; name: string; position: string | null; isPrimary: boolean }[];
};
type Page = { items: Person[]; total: number; counts: Record<string, number> };

describe('Kontakty: persons on their own', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let other: string;

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    const made = await jana.call<{ id: string }>('customer.create', {
      customer: {
        kind: 'organization',
        name: 'Asociácia na skúšku',
        role: 'partner',
        tags: [],
        productIds: [],
      },
    });
    other = made.data.id;
  });
  afterAll(async () => {
    await api.close();
  });

  it('brings a removed person back when the e-mail is added again (D-48)', async () => {
    const email = 'vratena.osoba@example.org';
    const first = await jana.call<{ id: string }>('person.create', {
      person: { firstName: 'Vratená', lastName: 'Stará', email, note: 'Volať dopoludnia.' },
      receivesBulk: false,
    });
    expect((await jana.call('person.delete', { id: first.data.id })).code).toBeUndefined();

    const again = await jana.call<{ id: string }>('person.create', {
      person: { firstName: 'Vratená', lastName: 'Nová', email },
      links: [{ customerId: other, isPrimary: false }],
    });
    expect(again.data.id).toBe(first.data.id);
    const back = await jana.call<{
      lastName: string;
      note: string | null;
      unsubscribedAt: string | null;
      organizations: { id: string }[];
    }>('person.get', { id: first.data.id });
    expect(back.data.lastName).toBe('Nová');
    expect(back.data.note).toBe('Volať dopoludnia.');
    expect(back.data.unsubscribedAt).not.toBeNull();
    expect(back.data.organizations.map((o) => o.id)).toEqual([other]);

    // Taken off the last organization, the person is removed and comes back at another one too.
    await jana.call('customer.contactDelete', { id: first.data.id, customerId: other });
    const atOrganization = await jana.call<{ id: string }>('customer.contactCreate', {
      customerId: HARMONIA,
      contact: { firstName: 'Vratená', lastName: 'Nová', email },
    });
    expect(atOrganization.code).toBeUndefined();
    expect(atOrganization.data.id).toBe(first.data.id);
  });

  it('keeps a person without any organization (D-2) and finds them by e-mail', async () => {
    const made = await jana.call<{ id: string }>('person.create', {
      person: { firstName: 'Andrea', lastName: 'Konzultantka', email: 'andrea.k@example.org' },
    });
    expect(made.code).toBeUndefined();
    const nowhere = await jana.call<Page>('person.list', { link: 'none', pageSize: 100 });
    expect(nowhere.data.items.some((p) => p.id === made.data.id)).toBe(true);
    const found = await jana.call<Person | null>('person.byEmail', {
      email: 'ANDREA.K@example.org',
    });
    expect(found.data?.id).toBe(made.data.id);
    const again = await jana.call('person.create', {
      person: { firstName: 'Iná', lastName: 'Osoba', email: 'andrea.k@example.org' },
    });
    expect(again.message).toBe('CONTACT_EMAIL_TAKEN');
  });

  it('puts a person at several organizations, a position at each (D-3)', async () => {
    const made = await jana.call<{ id: string }>('person.create', {
      person: { firstName: 'Viera', lastName: 'Dvojitá', email: 'viera.d@example.org' },
      links: [
        { customerId: HARMONIA, position: 'ekonómka' },
        { customerId: other, position: 'členka predsedníctva', isPrimary: true },
      ],
    });
    const person = (await jana.call<Person>('person.get', { id: made.data.id })).data;
    expect(person.organizations).toHaveLength(2);
    expect(person.organizations.find((o) => o.id === HARMONIA)).toMatchObject({
      position: 'ekonómka',
      isPrimary: false,
    });
    expect(person.organizations.find((o) => o.id === other)).toMatchObject({ isPrimary: true });
    // The organization's card says where else the person works („aj v …“).
    const card = await jana.call<{ contacts: { id: string; elsewhere: { id: string }[] }[] }>(
      'customer.get',
      { id: HARMONIA },
    );
    expect(card.data.contacts.find((c) => c.id === made.data.id)?.elsewhere).toEqual([
      expect.objectContaining({ id: other }),
    ]);
    const atHarmonia = await jana.call<Page>('person.list', {
      organizationId: [HARMONIA],
      pageSize: 100,
    });
    expect(atHarmonia.data.items.some((p) => p.id === made.data.id)).toBe(true);

    await jana.call('person.unlink', { id: made.data.id, customerId: HARMONIA });
    const after = (await jana.call<Person>('person.get', { id: made.data.id })).data;
    expect(after.organizations.map((o) => o.id)).toEqual([other]);
    await jana.call('person.link', {
      id: made.data.id,
      customerId: HARMONIA,
      position: 'riaditeľka',
    });
    const back = (await jana.call<Person>('person.get', { id: made.data.id })).data;
    expect(back.organizations.find((o) => o.id === HARMONIA)?.position).toBe('riaditeľka');
  });

  it('shows on the person only the activities they took part in (D-8)', async () => {
    const at = new Date().toISOString();
    const withEva = await jana.call<{ id: string }>('activity.create', {
      customerId: HARMONIA,
      activity: { kind: 'call', occurredAt: at, subject: 'S Evou', contactIds: [EVA] },
    });
    const without = await jana.call<{ id: string }>('activity.create', {
      customerId: HARMONIA,
      activity: { kind: 'meeting', occurredAt: at, subject: 'Interná porada' },
    });
    const items = (
      await jana.call<{ type: string; activity?: { id: string; organization: { id: string } } }[]>(
        'person.timeline',
        { id: EVA },
      )
    ).data.filter((item) => item.type === 'activity');
    const ids = items.map((item) => item.activity!.id);
    expect(ids).toContain(withEva.data.id);
    expect(ids).not.toContain(without.data.id);
    expect(
      items.find((item) => item.activity!.id === withEva.data.id)!.activity!.organization.id,
    ).toBe(HARMONIA);
  });

  it('renaming a private person renames their record; their person stays theirs', async () => {
    const found = (await jana.call<Page>('person.list', { search: 'Kováčová' })).data;
    const person = found.items.find((p) => p.organizations.some((o) => o.id === KOVACOVA))!;
    await jana.call('person.update', {
      id: person.id,
      person: { firstName: 'Mária', lastName: 'Kováčová-Nová', email: 'maria.kovacova@gmail.com' },
      receivesBulk: true,
    });
    const customer = await jana.call<{ name: string }>('customer.get', { id: KOVACOVA });
    expect(customer.data.name).toBe('Mária Kováčová-Nová');
    expect((await jana.call('person.unlink', { id: person.id, customerId: KOVACOVA })).code).toBe(
      'BAD_REQUEST',
    );
    expect((await jana.call('person.delete', { id: person.id })).code).toBe('BAD_REQUEST');
  });

  it('deletes a person: gone from Kontakty and from their organizations', async () => {
    const made = await jana.call<{ id: string }>('person.create', {
      person: { firstName: 'Odchádzajúca', lastName: 'Osoba' },
      links: [{ customerId: other }],
    });
    expect((await jana.call('person.delete', { id: made.data.id })).code).toBeUndefined();
    expect((await jana.call('person.get', { id: made.data.id })).code).toBe('NOT_FOUND');
    const at = (await jana.call<{ contacts: { id: string }[] }>('customer.get', { id: other }))
      .data;
    expect(at.contacts.some((c) => c.id === made.data.id)).toBe(false);
  });
});
