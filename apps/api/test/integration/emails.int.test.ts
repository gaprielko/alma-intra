import { COMPANY_ROOT_FOLDER_ID } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainCampaigns } from '../../src/campaigns/delivery.js';
import { loadEnv } from '../../src/config/env.js';
import { type InboundSource, receiveInbound } from '../../src/inbound/inbound.js';
import { syncInbound } from '../../src/inbound/intake.js';
import { memoryTransport, outbox } from '../../src/mail/transport.js';
import { storageKey } from '../../src/storage/storage.js';
import { browser, JANA, startApi } from './client.js';
import { memoryStorage } from './memory-storage.js';

const HARMONIA = '00000000-0000-4000-8000-d00000000001';
const EVA = '00000000-0000-4000-8000-e00000000010';
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('e-mails: sending, scheduling, segments, replies', () => {
  const bucket = memoryStorage();
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;

  beforeAll(async () => {
    api = await startApi({ storage: bucket.storage });
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

  it('shows a colleague’s titles in the user list and the e-mails, not elsewhere in the app', async () => {
    const profile = { name: 'Jana Horváthová', titleBefore: 'Mgr.', titleAfter: 'PhD.' };
    await jana.call('account.updateProfile', profile);
    const people = await jana.call<{ items: { name: string; fullName: string }[] }>(
      'user.list',
      {},
    );
    expect(people.data.items).toContainEqual(
      expect.objectContaining({ name: 'Jana Horváthová', fullName: 'Mgr. Jana Horváthová, PhD.' }),
    );
    const id = await draft();
    await jana.call('campaign.send', { id });
    const before = outbox.length;
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());
    expect(outbox.slice(before).find((m) => m.subject === 'Test')!.from).toMatch(
      /^Mgr\. Jana Horváthová, PhD\. \|/,
    );
    // The owner picker, like the rest of the app, shows the name alone.
    const options = await jana.call<{ users: { name: string }[] }>('customer.options');
    expect(options.data.users.map((u) => u.name)).toContain('Jana Horváthová');
    await jana.call('account.updateProfile', { ...profile, titleBefore: '', titleAfter: '' });
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

  it('lists a one-recipient e-mail under its own subject, not the variable names', async () => {
    const id = await draft();
    const subject = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ponuka pre ' },
            { type: 'variable', attrs: { name: 'customer.name' } },
          ],
        },
      ],
    };
    await api.db.execute(
      sql`update campaigns set subject = ${JSON.stringify(subject)}::jsonb where id = ${id}`,
    );
    const drafts = await jana.call<{ items: { id: string; subjectText: string }[] }>(
      'campaign.list',
      { status: 'draft', page: 1 },
    );
    expect(drafts.data.items.find((c) => c.id === id)?.subjectText).toBe(
      'Ponuka pre [Názov kontaktu]',
    );
    await jana.call('campaign.send', { id });
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());
    const sent = await jana.call<{ items: { id: string; subjectText: string }[] }>(
      'campaign.list',
      { status: 'sent', page: 1 },
    );
    expect(sent.data.items.find((c) => c.id === id)?.subjectText).toBe(
      'Ponuka pre ADOS Harmónia, s.r.o.',
    );
  });

  it('sends files as download links valid 30 days instead of attachments (D-26)', async () => {
    const id = await draft();
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
    const asked = await jana.call<{ fileId: string; versionId: string }>('file.requestUpload', {
      folderId: COMPANY_ROOT_FOLDER_ID,
      name: 'Cennik.pdf',
      size: pdf.byteLength,
    });
    await bucket.storage.put(
      storageKey(asked.data.fileId, asked.data.versionId),
      pdf,
      'application/pdf',
    );
    await jana.call('file.confirmUpload', { versionId: asked.data.versionId });
    await api.db.execute(
      sql`insert into campaign_attachments (campaign_id, file_id, position)
        values (${id}, ${asked.data.fileId}, 0)`,
    );
    await jana.call('campaign.setAttachmentsAsLinks', { id, asLinks: true });
    await jana.call('campaign.send', { id });
    const before = outbox.length;
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), bucket.storage, loadEnv());
    const mail = outbox.slice(before).find((m) => m.subject === 'Test')!;
    expect(mail.attachments).toBeUndefined();
    const link = /\/d\/([0-9a-f]{32}\.[0-9a-z]+\.[A-Za-z0-9_-]{32})/.exec(mail.html)![1]!;
    const opened = await fetch(`${api.baseUrl}/d/${link}`, { redirect: 'manual' });
    expect(opened.status).toBe(302);
    expect(opened.headers.get('location')).toContain(asked.data.versionId);
    const forged = await fetch(
      `${api.baseUrl}/d/${link.slice(0, -1)}${link.endsWith('A') ? 'B' : 'A'}`,
      { redirect: 'manual' },
    );
    expect(forged.status).toBe(404);
  });

  it('sends a template as it stands as a test to oneself', async () => {
    const before = outbox.length;
    const sent = await jana.call<{ sentTo: string }>('template.sendTest', {
      subject: doc('Ponuka'),
      body: doc('Dobrý deň.'),
      contactId: EVA,
    });
    expect(sent.data.sentTo).toBe(JANA);
    const mail = outbox.slice(before).find((m) => m.to === JANA)!;
    expect(mail.subject).toBe('TEST: Ponuka');
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

  it('takes in the received e-mails Intra does not have yet, once', async () => {
    const id = `test-sync-${Date.now()}`;
    const forwarded: string[] = [];
    const source: InboundSource = {
      recent: async () => [id],
      get: async (providerEmailId) => ({
        providerEmailId,
        from: 'Eva Tóthová <eva.tothova@adosharmonia.sk>',
        to: ['info@mail.alma-care.eu'],
        cc: [],
        receivedFor: [],
        subject: 'Otázka',
        html: null,
        text: 'Dobrý deň',
        headerMessageId: null,
        inReplyTo: null,
        references: null,
        attachments: [],
        receivedAt: new Date(),
      }),
      attachmentLinks: async () => [],
      forward: async (providerEmailId) => {
        forwarded.push(providerEmailId);
      },
    };
    const logger = new Logger('test');
    expect(await syncInbound(api.db, null, source, logger)).toEqual({ added: 1 });
    expect(await syncInbound(api.db, null, source, logger)).toEqual({ added: 0 });
    expect(forwarded).toEqual([id]);
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
    // Opened: the e-mail filed under a person, with the person's position and the conversation.
    const opened = await jana.call<{ contactName: string | null }>('inbound.get', {
      id: filed.id,
    });
    expect(opened.code).toBeUndefined();
    expect(opened.data.contactName).toContain('Tóthová');
    expect((await jana.call('inbound.thread', { id: filed.id })).code).toBeUndefined();
    const timeline = await jana.call<{ type: string }[]>('activity.timeline', {
      customerId: HARMONIA,
      filter: 'emails',
    });
    expect(timeline.data.some((item) => item.type === 'reply')).toBe(true);
    const owner = await api.db.execute<{ n: number }>(
      sql`select count(*)::int as n from notifications n join organizations c on c.owner_user_id = n.user_id
        where c.id = ${HARMONIA} and n.kind = 'reply' and n.ref_id = ${filed.id}`,
    );
    expect(owner.rows[0]!.n).toBe(1);
  });

  it('tells the contact owner when a colleague files an unknown e-mail to the contact', async () => {
    const filed = await receiveInbound(api.db, loadEnv(), {
      providerEmailId: `test-unknown-${Date.now()}`,
      from: 'Neznámy <nikto@example.org>',
      to: ['info@mail.alma-care.eu'],
      cc: [],
      receivedFor: [],
      subject: 'Otázka na ceny',
      html: '<p>Dobrý deň</p>',
      text: 'Dobrý deň',
      headerMessageId: '<y@example.org>',
      inReplyTo: null,
      references: null,
      attachments: [],
      receivedAt: new Date(),
    });
    expect(filed.matched).toBeNull();
    await jana.call('inbound.assign', { id: filed.id, customerId: HARMONIA, contactId: null });
    const told = await api.db.execute<{ subject: string }>(
      sql`select n.subject from notifications n join organizations c on c.owner_user_id = n.user_id
        where c.id = ${HARMONIA} and n.ref_id = ${filed.id}`,
    );
    expect(told.rows.map((row) => row.subject)).toEqual(['Otázka na ceny']);
  });

  it('Prijaté: full text within the filters, without regard to diacritics', async () => {
    type List = { items: { subject: string | null }[] };
    const subjects = async (input: Record<string, unknown>) =>
      (await jana.call<List>('inbound.list', { view: 'all', ...input })).data.items.map(
        (item) => item.subject,
      );
    expect(await subjects({ search: 'otazka na CENY' })).toContain('Otázka na ceny');
    expect(await subjects({ search: 'ados harmonia', customerId: HARMONIA })).toEqual(
      expect.arrayContaining(['Otázka na ceny', 'Re: Test']),
    );
    expect(await subjects({ search: 'nikto', withAttachments: true })).toEqual([]);
  });

  it('groups a conversation by its subject: one row, the rest in the thread', async () => {
    const receive = (subject: string, minutes: number) =>
      receiveInbound(api.db, loadEnv(), {
        providerEmailId: `test-thread-${subject}-${Date.now()}`,
        from: 'Zuzana Nová <zuzana@example.net>',
        to: ['info@mail.alma-care.eu'],
        cc: [],
        receivedFor: [],
        subject,
        html: null,
        text: subject,
        headerMessageId: null,
        inReplyTo: null,
        references: null,
        attachments: [],
        receivedAt: new Date(Date.now() - minutes * 60_000),
      });
    const first = await receive('Termín školenia', 10);
    const second = await receive('RE: Re: Termín školenia', 1);
    type Row = { id: string; inThread: number };
    const rows = (
      await jana.call<{ items: Row[] }>('inbound.list', { view: 'all', search: 'školenia' })
    ).data.items;
    expect(rows).toEqual([expect.objectContaining({ id: second.id, inThread: 2 })]);
    const thread = await jana.call<{ id: string; kind: string }[]>('inbound.thread', {
      id: second.id,
    });
    expect(thread.data).toEqual([expect.objectContaining({ id: first.id, kind: 'received' })]);
    // Another subject from the same sender is another conversation, offered beside it.
    const other = await receive('Faktúra za október', 5);
    const others = await jana.call<{ id: string; inThread: number }[]>('inbound.others', {
      id: second.id,
    });
    expect(others.data).toEqual([expect.objectContaining({ id: other.id, inThread: 1 })]);
    const back = await jana.call<{ id: string }[]>('inbound.others', { id: other.id });
    expect(back.data).toEqual([expect.objectContaining({ id: second.id, inThread: 2 })]);
  });
});
