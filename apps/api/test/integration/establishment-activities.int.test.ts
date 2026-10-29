import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recipientCandidates } from '../../src/campaigns/campaigns.service.js';
import { SEED_USERS } from '../../src/db/seed.js';
import { valuesFor } from '../../src/email/templates.service.js';
import { browser, JANA, startApi } from './client.js';

type Item = { type: string; activity?: { id: string; organization: { id: string } } };

describe('activities and e-mails of an organization and its prevádzky', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let org: string;
  let est: string;
  let nurse: string;

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    org = (
      await jana.call<{ id: string }>('customer.create', {
        customer: {
          kind: 'organization',
          name: 'Sieť ADOS Levoča, s.r.o.',
          role: 'customer',
          tags: [],
          productIds: [],
        },
      })
    ).data.id;
    est = (
      await jana.call<{ id: string }>('customer.establishmentCreate', {
        parentId: org,
        establishment: { name: 'Sieť ADOS Levoča Spiš' },
        primary: {
          kind: 'new',
          contact: { firstName: 'Mária', lastName: 'Spišská', position: 'vedúca sestra' },
        },
      })
    ).data.id;
    const options = await jana.call<{ contacts: { id: string; places: string[] }[] }>(
      'activity.options',
      { id: org },
    );
    nurse = options.data.contacts.find((c) => c.places.includes(est))!.id;
  });
  afterAll(async () => {
    await api.close();
  });

  const record = (extra: Record<string, unknown>) =>
    jana.call<{ id: string }>('activity.create', {
      customerId: org,
      activity: { kind: 'call', occurredAt: new Date().toISOString(), ...extra },
    });
  const timeline = (withEstablishments: boolean) =>
    jana.call<Item[]>('activity.timeline', {
      customerId: org,
      filter: 'activities',
      withEstablishments,
    });

  it('files an activity with a prevádzka’s person under that prevádzka', async () => {
    const atEst = await record({ subject: 'Spiš', contactIds: [nurse] });
    const atOrg = await record({ subject: 'Centrála' });
    const all = await timeline(true);
    const where = (id: string) =>
      all.data.find((i) => i.activity?.id === id)?.activity?.organization.id;
    expect(where(atEst.data.id)).toBe(est);
    expect(where(atOrg.data.id)).toBe(org);
    // „Aj prevádzky“ off: the organization's own only.
    const own = await timeline(false);
    expect(own.data.some((i) => i.activity?.id === atEst.data.id)).toBe(false);
    expect(own.data.some((i) => i.activity?.id === atOrg.data.id)).toBe(true);
  });

  it('„Patrí k“ wins over the rule, and an edit moves the activity', async () => {
    const made = await record({ subject: 'Za centrálu', contactIds: [nurse], organizationId: org });
    let all = await timeline(true);
    expect(all.data.find((i) => i.activity?.id === made.data.id)?.activity?.organization.id).toBe(
      org,
    );
    await jana.call('activity.update', {
      id: made.data.id,
      activity: {
        kind: 'call',
        occurredAt: new Date().toISOString(),
        contactIds: [nurse],
        organizationId: est,
      },
    });
    all = await timeline(true);
    expect(all.data.find((i) => i.activity?.id === made.data.id)?.activity?.organization.id).toBe(
      est,
    );
  });

  it('refuses „Patrí k“ outside the organization', async () => {
    const refused = await record({ organizationId: '00000000-0000-4000-8000-d00000000001' });
    expect(refused.message).toBe('CUSTOMER_NOT_FOUND');
  });

  it('an e-mail to a prevádzka’s person names the organization and the prevádzka', async () => {
    const [candidate] = await recipientCandidates(api.db, [org]);
    expect(candidate!.contacts).toEqual([
      expect.objectContaining({
        id: nurse,
        isPrimary: false,
        establishment: expect.objectContaining({ id: est, isPrimary: true }),
      }),
    ]);
    const { values } = await valuesFor(
      api.db,
      { contactId: nurse, customerId: org },
      SEED_USERS.jana,
      {},
    );
    expect(values['customer.name']).toBe('Sieť ADOS Levoča, s.r.o.');
    expect(values['establishment.name']).toBe('Sieť ADOS Levoča Spiš');
    expect(values['contact.position']).toBe('vedúca sestra');
  });
});
