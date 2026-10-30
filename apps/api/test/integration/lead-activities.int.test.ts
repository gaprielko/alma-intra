import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainCampaigns } from '../../src/campaigns/delivery.js';
import { loadEnv } from '../../src/config/env.js';
import { memoryTransport, outbox } from '../../src/mail/transport.js';
import { browser, JANA, startApi } from './client.js';
import { memoryStorage } from './memory-storage.js';

const HARMONIA = '00000000-0000-4000-8000-d00000000001';
const EVA = '00000000-0000-4000-8000-e00000000010';
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

interface Entry {
  id: string;
  productId: string;
  organizationId: string;
  contactId: string | null;
  contactName: string | null;
  email: string | null;
  subject: string | null;
  createdAt: string;
  lastConfirmedAt: string;
}

describe('Aktivity: serious interest from an e-mail button', () => {
  const bucket = memoryStorage();
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let stranger: ReturnType<typeof browser>;
  let productId: string;

  beforeAll(async () => {
    api = await startApi({ storage: bucket.storage });
    jana = browser(api.baseUrl);
    stranger = browser(api.baseUrl);
    await jana.signIn(JANA);
    const made = await jana.call<{ id: string }>('product.create', {
      name: 'Záujem Test',
      basePrice: null,
      basePriceGross: null,
      period: 'month',
      active: true,
      workloadStep: 10,
      items: [],
    });
    expect(made.code).toBeUndefined();
    productId = made.data.id;
  });
  afterAll(async () => {
    await api.close();
  });

  const body = () => ({
    type: 'doc',
    content: [
      ...doc('Dobrý deň.').content,
      {
        type: 'button',
        attrs: { text: 'Mám vážny záujem', href: '', interestProductId: productId },
      },
    ],
  });

  /** Sends the button to Eva Tóthová and gives back the token of her link. */
  async function send() {
    const made = await jana.call<{ id: string }>('campaign.create', { customerIds: [] });
    await jana.call('campaign.setRecipients', {
      id: made.data.id,
      recipients: [{ customerId: HARMONIA, contactId: EVA }],
    });
    await api.db.execute(
      sql`update campaigns set subject = ${JSON.stringify(doc('Záujem'))}::jsonb,
        body = ${JSON.stringify(body())}::jsonb where id = ${made.data.id}`,
    );
    expect((await jana.call('campaign.send', { id: made.data.id })).code).toBeUndefined();
    return { id: made.data.id, token: await tokenAfterDrain(made.data.id) };
  }

  async function tokenAfterDrain(campaignId: string) {
    const before = outbox.length;
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());
    const mail = outbox.slice(before).at(-1)!;
    const token = /\/zaujem#([^"&]+)/.exec(mail.html)?.[1];
    expect(token, campaignId).toBeTruthy();
    return token!;
  }

  const entries = async () =>
    (await jana.call<{ items: Entry[]; total: number }>('leadActivity.list', {})).data;

  it('records nothing when the page opens, and one entry when the button is pressed', async () => {
    const { token } = await send();
    const info = await stranger.call<{ email: string; product: string }>('interest.info', {
      token,
    });
    expect(info.data).toMatchObject({ email: 'e***@adosharmonia.sk', product: 'Záujem Test' });
    expect((await entries()).total).toBe(0);

    const done = await stranger.call<{ repeated: boolean }>('interest.confirm', { token });
    expect(done.data.repeated).toBe(false);
    const { items, total } = await entries();
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      productId,
      organizationId: HARMONIA,
      contactId: EVA,
      email: 'eva.tothova@adosharmonia.sk',
      subject: 'Záujem',
    });
    expect(items[0]!.contactName).toContain('Tóthová');
  });

  it('keeps one entry per contact and product, and moves the last confirmation', async () => {
    const { token } = await send();
    const [first] = (await entries()).items;
    const again = await stranger.call<{ repeated: boolean }>('interest.confirm', { token });
    expect(again.data.repeated).toBe(true);
    const { items, total } = await entries();
    expect(total).toBe(1);
    expect(items[0]!.id).toBe(first!.id);
    expect(new Date(items[0]!.lastConfirmedAt).getTime()).toBeGreaterThan(
      new Date(first!.lastConfirmedAt).getTime(),
    );
  });

  it('tells the sender once, in the bell', async () => {
    const list = await jana.call<{ items: { kind: string; refId: string }[] }>('notification.list');
    const [entry] = (await entries()).items;
    expect(list.data.items.filter((n) => n.kind === 'interest')).toEqual([
      expect.objectContaining({ refId: entry!.id }),
    ]);
  });

  it('shows on the timelines of the organization and the contact', async () => {
    const [entry] = (await entries()).items;
    const organization = await jana.call<{ type: string; interest?: { id: string } }[]>(
      'activity.timeline',
      { customerId: HARMONIA, filter: 'interest' },
    );
    expect(organization.data.map((i) => i.interest?.id)).toEqual([entry!.id]);
    const person = await jana.call<{ type: string; interest?: { id: string } }[]>(
      'person.timeline',
      { id: EVA, filter: 'all' },
    );
    expect(person.data.some((i) => i.interest?.id === entry!.id)).toBe(true);
  });

  it('filters the list by words and product', async () => {
    const found = await jana.call<{ total: number }>('leadActivity.list', { search: 'tothova' });
    expect(found.data.total).toBe(1);
    const nothing = await jana.call<{ total: number }>('leadActivity.list', { search: 'nikto' });
    expect(nothing.data.total).toBe(0);
    const other = await jana.call<{ total: number }>('leadActivity.list', {
      productId: '00000000-0000-4000-8000-000000000999',
    });
    expect(other.data.total).toBe(0);
  });

  it('removes an entry; a new confirmation makes a new one', async () => {
    const { token } = await send();
    const [entry] = (await entries()).items;
    expect((await jana.call('leadActivity.delete', { id: entry!.id })).code).toBeUndefined();
    expect((await jana.call('leadActivity.get', { id: entry!.id })).code).toBe('NOT_FOUND');
    expect((await entries()).total).toBe(0);
    const anew = await stranger.call<{ repeated: boolean }>('interest.confirm', { token });
    expect(anew.data.repeated).toBe(false);
    const [next] = (await entries()).items;
    expect(next!.id).not.toBe(entry!.id);
  });

  it('refuses a made-up token, and the link of an e-mail that has not left', async () => {
    expect((await stranger.call('interest.confirm', { token: 'x'.repeat(40) })).code).toBe(
      'NOT_FOUND',
    );
    const { interestToken } = await import('../../src/campaigns/interest-link.js');
    const made = await jana.call<{ id: string }>('campaign.create', { customerIds: [] });
    await jana.call('campaign.setRecipients', {
      id: made.data.id,
      recipients: [{ customerId: HARMONIA, contactId: EVA }],
    });
    const rows = await api.db.execute<{ id: string }>(
      sql`select id from campaign_messages where campaign_id = ${made.data.id}`,
    );
    const token = interestToken(loadEnv(), rows.rows[0]!.id, productId);
    expect((await stranger.call('interest.info', { token })).code).toBe('NOT_FOUND');
  });

  it('refuses a plain button without an address, and takes one with a product', async () => {
    const { emailDocProblem } = await import('@intra/shared/schemas');
    const button = (attrs: Record<string, unknown>) =>
      ({ type: 'doc', content: [{ type: 'button', attrs }] }) as never;
    expect(emailDocProblem(button({ text: 'A', href: '' }), new Set())).toBe('invalid_link');
    expect(
      emailDocProblem(button({ text: 'A', href: '', interestProductId: productId }), new Set()),
    ).toBeNull();
  });

  it('keeps a product somebody is interested in', async () => {
    const refused = await jana.call('product.delete', { id: productId });
    expect(refused.code).toBeDefined();
  });
});
