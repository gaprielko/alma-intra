import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

const HARMONIA = '00000000-0000-4000-8000-d00000000001';

type Candidate = {
  id: string;
  email: string;
  status: string;
  contactId: string | null;
  alreadyHere: boolean;
  clash: {
    name: string;
    organizations: number;
    changes: { field: string; from: string | null; to: string | null }[];
  } | null;
};
type Person = {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  titleBefore: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  salutation: string | null;
  organizations: { id: string; position: string | null }[];
};

describe('A contact made from a user (D-47)', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let other: string;

  const candidates = async (customerId: string) =>
    (await jana.call<Candidate[]>('person.userCandidates', { customerId })).data;
  const person = async (id: string) => (await jana.call<Person>('person.get', { id })).data;
  /** A colleague of their own for each test, so that the tests do not depend on one another. */
  const invite = async (email: string, name: string, phone?: string) => {
    const made = await jana.call<{ id: string }>('user.invite', { email, name, phone });
    expect(made.code).toBeUndefined();
    return made.data.id;
  };

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    const made = await jana.call<{ id: string }>('customer.create', {
      customer: {
        kind: 'organization',
        name: 'Asociácia na skúšku používateľov',
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

  it('makes a contact from a user, and the same contact at a second organization', async () => {
    const userId = await invite(
      'adela.nova@alma-care.test',
      'Adela Mária Nová',
      '+421 900 000 301',
    );
    const offered = (await candidates(HARMONIA)).find((c) => c.id === userId);
    expect(offered).toMatchObject({ status: 'invited', contactId: null, alreadyHere: false });

    const added = await jana.call<{ id: string }>('person.addUser', {
      userId,
      customerId: HARMONIA,
      position: 'konzultantka',
    });
    expect(added.code).toBeUndefined();
    expect(await person(added.data.id)).toMatchObject({
      userId,
      firstName: 'Adela Mária',
      lastName: 'Nová',
      email: 'adela.nova@alma-care.test',
      phone: '+421 900 000 301',
    });
    expect((await candidates(HARMONIA)).find((c) => c.id === userId)).toMatchObject({
      contactId: added.data.id,
      alreadyHere: true,
    });

    const again = await jana.call<{ id: string }>('person.addUser', { userId, customerId: other });
    expect(again.data.id).toBe(added.data.id);
    expect((await person(added.data.id)).organizations.map((o) => o.id).sort()).toEqual(
      [HARMONIA, other].sort(),
    );
  });

  it('carries a change of the user to the contact, and never the other way round', async () => {
    const userId = await invite('boris.maly@alma-care.test', 'Boris Malý', '+421 900 000 302');
    const { data } = await jana.call<{ id: string }>('person.addUser', {
      userId,
      customerId: HARMONIA,
    });

    const changed = await jana.call('user.update', {
      userId,
      name: 'Boris Veľký',
      titleBefore: 'Ing.',
      phone: '+421 900 000 303',
    });
    expect(changed.code).toBeUndefined();
    const now = await person(data.id);
    expect(now).toMatchObject({
      firstName: 'Boris',
      lastName: 'Veľký',
      titleBefore: 'Ing.',
      phone: '+421 900 000 303',
    });

    const fields = {
      titleBefore: 'Ing.',
      firstName: 'Boris',
      lastName: 'Veľký',
      email: 'boris.maly@alma-care.test',
      phone: '+421 900 000 303',
    };
    const refused = await jana.call('person.update', {
      id: data.id,
      person: { ...fields, lastName: 'Iný' },
      receivesBulk: true,
    });
    expect(refused.message).toBe('FOLLOWS_USER');
    const refusedAtOrganization = await jana.call('customer.contactUpdate', {
      id: data.id,
      customerId: HARMONIA,
      contact: { ...fields, phone: '+421 900 000 399' },
      receivesBulk: true,
    });
    expect(refusedAtOrganization.message).toBe('FOLLOWS_USER');
    expect((await person(data.id)).lastName).toBe('Veľký');

    // What the contact has of its own stays editable.
    const own = await jana.call('person.update', {
      id: data.id,
      person: { ...fields, gender: 'male', salutation: 'Vážený pán inžinier' },
      receivesBulk: true,
    });
    expect(own.code).toBeUndefined();
    expect(await person(data.id)).toMatchObject({
      gender: 'male',
      salutation: 'Vážený pán inžinier',
    });
    const users = await jana.call<{ items: { id: string; name: string }[] }>('user.list', {});
    expect(users.data.items.find((u) => u.id === userId)?.name).toBe('Boris Veľký');
  });

  it('carries a change in „Môj účet“ too', async () => {
    const me = await jana.call<{ id: string }>('auth.me');
    const { data } = await jana.call<{ id: string }>('person.addUser', {
      userId: me.data.id,
      customerId: other,
    });
    const changed = await jana.call('account.updateProfile', {
      name: 'Jana Horváthová Nová',
      phone: '+421 900 000 306',
    });
    expect(changed.code).toBeUndefined();
    expect(await person(data.id)).toMatchObject({
      firstName: 'Jana Horváthová',
      lastName: 'Nová',
      phone: '+421 900 000 306',
    });
  });

  it('connects a contact with the same e-mail only after it was shown what changes', async () => {
    const made = await jana.call<{ id: string }>('person.create', {
      person: {
        firstName: 'Cyril',
        lastName: 'Starý',
        email: 'cyril.novy@alma-care.test',
        phone: '+421 900 000 304',
        salutation: 'Vážený pán Starý',
      },
    });
    const userId = await invite('cyril.novy@alma-care.test', 'Cyril Nový', '+421 900 000 305');

    const offered = (await candidates(HARMONIA)).find((c) => c.id === userId);
    expect(offered?.contactId).toBeNull();
    expect(offered?.clash?.changes).toEqual([
      { field: 'lastName', from: 'Starý', to: 'Nový' },
      { field: 'phone', from: '+421 900 000 304', to: '+421 900 000 305' },
    ]);

    const refused = await jana.call('person.addUser', { userId, customerId: HARMONIA });
    expect(refused.message).toBe('CONTACT_EMAIL_TAKEN');
    expect((await person(made.data.id)).userId).toBeNull();

    const connected = await jana.call<{ id: string }>('person.addUser', {
      userId,
      customerId: HARMONIA,
      connect: true,
    });
    expect(connected.data.id).toBe(made.data.id);
    expect(await person(made.data.id)).toMatchObject({
      userId,
      lastName: 'Nový',
      phone: '+421 900 000 305',
      salutation: 'Vážený pán Starý',
    });
  });

  it('keeps a deactivated user off the list and their contact locked', async () => {
    const userId = await invite('dana.tiha@alma-care.test', 'Dana Tichá');
    const { data } = await jana.call<{ id: string }>('person.addUser', {
      userId,
      customerId: HARMONIA,
    });
    const gone = await jana.call('user.deactivate', { userId });
    expect(gone.code).toBeUndefined();

    expect((await candidates(HARMONIA)).some((c) => c.id === userId)).toBe(false);
    const refused = await jana.call('person.addUser', { userId, customerId: other });
    expect(refused.message).toBe('USER_NOT_AVAILABLE');
    const locked = await jana.call('person.update', {
      id: data.id,
      person: { firstName: 'Dana', lastName: 'Hlučná', email: 'dana.tiha@alma-care.test' },
      receivesBulk: true,
    });
    expect(locked.message).toBe('FOLLOWS_USER');
  });

  it('leaves an ordinary contact with its details after disconnecting', async () => {
    const userId = await invite('emil.volny@alma-care.test', 'Emil Voľný');
    const { data } = await jana.call<{ id: string }>('person.addUser', {
      userId,
      customerId: HARMONIA,
    });
    expect((await jana.call('person.disconnectUser', { id: data.id })).code).toBeUndefined();
    expect(await person(data.id)).toMatchObject({ userId: null, lastName: 'Voľný' });

    const edited = await jana.call('person.update', {
      id: data.id,
      person: { firstName: 'Emil', lastName: 'Iný', email: 'emil.volny@alma-care.test' },
      receivesBulk: true,
    });
    expect(edited.code).toBeUndefined();
    await jana.call('user.update', { userId, name: 'Emil Zmenený' });
    expect((await person(data.id)).lastName).toBe('Iný');
  });
});
