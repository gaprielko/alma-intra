import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainCampaigns } from '../../src/campaigns/delivery.js';
import { loadEnv } from '../../src/config/env.js';
import { receiveInbound } from '../../src/inbound/inbound.js';
import { memoryTransport, outbox } from '../../src/mail/transport.js';
import { browser, JANA, startApi } from './client.js';

const HARMONIA = '00000000-0000-4000-8000-d00000000001';
const EVA = '00000000-0000-4000-8000-e00000000010';
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('e-mails: sending, scheduling, segments, replies', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
  });
  afterAll(async () => {
    await api.close();
  });

  /** A draft to Eva Tóthová with plain text, as the wizard would leave it. */
  async function draft() {
    const made = await jana.call<{ id: string }>('campaign.create', { customerIds: [] });
    await jana.call('campaign.setRecipients', {
      id: made.data.id,
      recipients: [{ customerId: HARMONIA, contactId: EVA }],
    });
    await api.db.execute(
      sql`update campaigns set subject = ${JSON.stringify(doc('Test'))}::jsonb,
        body = ${JSON.stringify(doc('Dobrý deň.'))}::jsonb where id = ${made.data.id}`,
    );
    return made.data.id;
  }
  const statusOf = async (id: string) =>
    (await jana.call<{ status: string }>('campaign.get', { id })).data.status;

  it('queues an e-mail, the worker sends it with a one-click unsubscribe, and it is sent', async () => {
    const id = await draft();
    expect((await jana.call('campaign.send', { id })).code).toBeUndefined();
    const before = outbox.length;
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());
    const mail = outbox.slice(before).find((m) => m.subject === 'Test')!;
    expect(mail.to).toBe('eva.tothova@adosharmonia.sk');
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(await statusOf(id)).toBe('sent');
  });

  it('„Použiť znova“ makes a new draft with the same text and recipients', async () => {
    const id = await draft();
    await jana.call('campaign.send', { id });
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());
    const reused = await jana.call<{ id: string; left: number }>('campaign.reuse', { id });
    expect(reused.data.left).toBe(0);
    const copy = await jana.call<{
      status: string;
      subject: unknown;
      messages: { contactId: string | null }[];
    }>('campaign.get', { id: reused.data.id });
    expect(copy.data.status).toBe('draft');
    expect(copy.data.subject).toEqual(doc('Test'));
    expect(copy.data.messages.map((m) => m.contactId)).toEqual([EVA]);
  });

  it('schedules: refuses a time too close, waits, and goes back to a draft when cancelled', async () => {
    const id = await draft();
    const soon = new Date(Date.now() + 60_000).toISOString();
    expect((await jana.call('campaign.send', { id, at: soon })).message).toBe('BAD_SCHEDULE');
    const later = new Date(Date.now() + 3_600_000).toISOString();
    await jana.call('campaign.send', { id, at: later });
    expect(await statusOf(id)).toBe('scheduled');
    const before = outbox.length;
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());
    expect(outbox.length).toBe(before);
    await jana.call('campaign.unschedule', { id });
    expect(await statusOf(id)).toBe('draft');
  });

  it('a segment finds the contacts its filters find today', async () => {
    const made = await jana.call<{ id: string }>('segment.create', {
      name: 'Košický kraj',
      filters: { region: 'kosice' },
      shared: true,
    });
    const found = await jana.call<{ ids: string[] }>('segment.customerIds', { id: made.data.id });
    expect(found.data.ids).toContain(HARMONIA);
  });

  it('files a reply by the sender and tells whoever has the contact in hand', async () => {
    const filed = await receiveInbound(api.db, loadEnv(), {
      providerEmailId: `test-${Date.now()}`,
      from: 'Eva Tóthová <Eva.Tothova@adosharmonia.sk>',
      to: ['info@mail.alma-care.eu'],
      cc: [],
      receivedFor: [],
      subject: 'Re: Test',
      html: '<p>Ďakujem</p>',
      text: 'Ďakujem',
      headerMessageId: '<x@ados>',
      inReplyTo: null,
      references: null,
      attachments: [],
      receivedAt: new Date(),
    });
    expect(filed.matched).toBe('sender');
    const timeline = await jana.call<{ type: string }[]>('activity.timeline', {
      customerId: HARMONIA,
      filter: 'emails',
    });
    expect(timeline.data.some((item) => item.type === 'reply')).toBe(true);
    const owner = await api.db.execute<{ n: number }>(
      sql`select count(*)::int as n from notifications n join customers c on c.owner_user_id = n.user_id
        where c.id = ${HARMONIA} and n.kind = 'reply' and n.ref_id = ${filed.id}`,
    );
    expect(owner.rows[0]!.n).toBe(1);
  });
});
