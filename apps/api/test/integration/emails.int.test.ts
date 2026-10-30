import { COMPANY_ROOT_FOLDER_ID } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainCampaigns } from '../../src/campaigns/delivery.js';
import { loadEnv } from '../../src/config/env.js';
import { type InboundSource, receiveInbound } from '../../src/inbound/inbound.js';
import { syncInbound, takeInReceived } from '../../src/inbound/intake.js';
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

  it('adds a forwarded e-mail to the conversation only when asked, once', async () => {
    const OWN = 'sukromna@example.org';
    const forward = async (id: string, from: string, block: string, sender = OWN) => {
      const email = {
        providerEmailId: `import-${id}-${Date.now()}`,
        from: sender,
        to: ['info@alma-care.eu'],
        cc: [],
        receivedFor: [],
        subject: 'Fwd: stará pošta',
        html: null,
        text: `---------- Forwarded message ---------\nFrom: ${from}\n${block}`,
        headerMessageId: null,
        inReplyTo: null,
        references: null,
        attachments: [],
        receivedAt: new Date(),
      };
      const source: InboundSource = {
        get: async () => email,
        attachmentLinks: async () => [],
        forward: async () => {
          throw new Error('an import forwards nothing');
        },
        recent: async () => [],
      };
      await takeInReceived(api.db, null, source, email.providerEmailId, new Logger('test'));
      const [row] = await api.db
        .execute<{ id: string }>(
          sql`select id from inbound_messages where provider_email_id = ${email.providerEmailId}`,
        )
        .then((result) => result.rows);
      return row!.id;
    };
    const add = (id: string) => jana.call<{ outcome: string }>('inbound.importForward', { id });
    const fromEva = `Date: Tue, Mar 10, 2026 at 9:00 AM\nSubject: Import ponuka\nTo: <${OWN}>\n\nĎakujem za ponuku.\n\nOn Mon, Mar 9, 2026 at 8:00 AM <${OWN}> wrote:\n> Staré.\n`;
    const toEva = `Date: Mon, Mar 9, 2026 at 8:00 AM\nSubject: Import ponuka\nTo: Eva <eva.tothova@adosharmonia.sk>\n\nPosielam ponuku.\n`;
    const list = async (search: string) =>
      (
        await jana.call<{
          items: {
            id: string;
            subject: string;
            status: string;
            fromEmail: string;
            preview: string;
          }[];
        }>('inbound.list', { view: 'all', search })
      ).data.items;

    await jana.call('account.setImportAddresses', { addresses: [OWN.toUpperCase()] });

    // Until asked: an ordinary e-mail, with the forward's own subject and sender.
    const received0 = await forward('received', 'Eva <eva.tothova@adosharmonia.sk>', fromEva);
    const [waitingToAdd] = await list('Import ponuka');
    expect(waitingToAdd).toMatchObject({ subject: 'Fwd: stará pošta', fromEmail: OWN });

    // An e-mail that carries no original refuses, and stays as it is.
    const plain = await receiveInbound(api.db, loadEnv(), {
      providerEmailId: `import-plain-${Date.now()}`,
      from: OWN,
      to: ['info@alma-care.eu'],
      cc: [],
      receivedFor: [],
      subject: 'Bežný e-mail',
      html: null,
      text: 'Dobrý deň',
      headerMessageId: null,
      inReplyTo: null,
      references: null,
      attachments: [],
      receivedAt: new Date(),
    });
    expect((await add(plain.id!)).message).toBe('NOT_A_FORWARD');

    // The preview says where it goes and stores nothing.
    const preview = await jana.call<{ direction: string; organizations: string[] }>(
      'inbound.importPreview',
      { id: received0 },
    );
    expect(preview.data.direction).toBe('received');
    expect(preview.data.organizations).toHaveLength(1);
    expect((await list('Import ponuka'))[0]!.subject).toBe('Fwd: stará pošta');

    // Received: the original's sender, subject and date, the quote left out.
    expect((await add(received0)).data.outcome).toBe('received');
    const [received] = await list('Import ponuka');
    expect(received).toMatchObject({
      id: received0,
      subject: 'Import ponuka',
      fromEmail: 'eva.tothova@adosharmonia.sk',
      status: 'assigned',
    });
    const opened = await jana.call<{ receivedAt: string; text: string; readAt: string | null }>(
      'inbound.get',
      { id: received!.id },
    );
    expect(opened.data.receivedAt).toBe('2026-03-10T08:00:00.000Z');
    expect(opened.data.text).toBe('Ďakujem za ponuku.');
    expect(opened.data.readAt).not.toBeNull();

    // Added once: neither that row again, nor the same original forwarded again.
    expect((await add(received0)).message).toBe('ALREADY_IMPORTED');
    const again = await forward('again', 'Eva <eva.tothova@adosharmonia.sk>', fromEva);
    expect((await add(again)).message).toBe('ALREADY_IMPORTED');
    await jana.call('inbound.discard', { id: again });

    // Own: in „Odoslané“ with the original date, in the same conversation, and nothing goes out.
    const queuedBefore = outbox.length;
    const own = await forward('own', `Ja <${OWN}>`, toEva);
    expect((await add(own)).data.outcome).toBe('sent');
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());
    expect(outbox.length).toBe(queuedBefore);
    const thread = await jana.call<{ kind: string; at: string; to: string }[]>('inbound.thread', {
      id: received!.id,
    });
    expect(thread.data).toEqual([
      expect.objectContaining({
        kind: 'sent',
        at: '2026-03-09T07:00:00.000Z',
        to: 'Eva',
      }),
    ]);
    expect(await list('Import ponuka')).toHaveLength(1);

    // Own, to nobody known: waits among the unassigned; filed, it is sent mail.
    const unknown = await forward(
      'unknown',
      `Ja <${OWN}>`,
      `Date: Wed, Mar 11, 2026 at 10:00 AM\nSubject: Komu neviem\nTo: nikto@example.net\n\nText.\n`,
    );
    expect((await add(unknown)).data.outcome).toBe('waiting');
    const [waiting] = await list('Komu neviem');
    expect(waiting).toMatchObject({ status: 'unassigned', fromEmail: OWN });
    await jana.call('inbound.assign', { id: waiting!.id, customerId: HARMONIA, contactId: null });
    expect(await list('Komu neviem')).toEqual([]);
    const sent = await api.db.execute<{ to_email: string; status: string }>(
      sql`select to_email, status from campaign_messages where subject = 'Komu neviem'`,
    );
    expect(sent.rows).toEqual([{ to_email: 'nikto@example.net', status: 'sent' }]);
  });

  it('Nový e-mail: one send to To, Cc and Bcc, known recipients on the timeline', async () => {
    const created = await jana.call<{ id: string }>('campaign.createDirect');
    const id = created.data.id;
    const body = doc('Dobrý deň, posielam podklady.');
    const save = (recipients: unknown[], subject = 'Podklady pre zmluvu') =>
      jana.call('campaign.saveDirect', {
        id,
        recipients,
        subject,
        body,
        templateId: null,
        lookProductId: null,
        attachmentFileIds: [],
      });
    // Without anyone in Komu it does not leave.
    await save([]);
    expect((await jana.call('campaign.sendDirect', { id })).message).toBe('NO_RECIPIENTS');

    await save([
      {
        role: 'bcc',
        email: 'tajny@example.net',
        name: null,
        contactId: null,
        organizationId: null,
      },
      {
        role: 'to',
        email: 'eva.tothova@adosharmonia.sk',
        name: 'Eva',
        contactId: EVA,
        organizationId: HARMONIA,
      },
      { role: 'cc', email: 'kopia@example.net', name: null, contactId: null, organizationId: null },
      { role: 'to', email: 'novy@example.net', name: null, contactId: null, organizationId: null },
    ]);
    const before = outbox.length;
    expect((await jana.call('campaign.sendDirect', { id })).code).toBeUndefined();
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());

    // One e-mail, not four, with everybody on it and no unsubscribe link.
    expect(outbox.length).toBe(before + 1);
    const mail = outbox.at(-1)!;
    expect(mail).toMatchObject({
      to: 'eva.tothova@adosharmonia.sk',
      alsoTo: ['novy@example.net'],
      cc: ['kopia@example.net'],
      bcc: ['tajny@example.net'],
      subject: 'Podklady pre zmluvu',
    });
    expect(mail.headers?.['List-Unsubscribe']).toBeUndefined();
    expect(mail.html).toContain('posielam podklady');
    expect(mail.html).not.toContain('odhlasenie');

    const rows = await api.db.execute<{ to_email: string; status: string; role: string }>(
      sql`select to_email, status, recipient_role as role from campaign_messages
        where campaign_id = ${id} order by position`,
    );
    expect(rows.rows.map((r) => [r.to_email, r.role, r.status])).toEqual([
      ['eva.tothova@adosharmonia.sk', 'to', 'sent'],
      ['novy@example.net', 'to', 'sent'],
      ['kopia@example.net', 'cc', 'sent'],
      ['tajny@example.net', 'bcc', 'sent'],
    ]);
    // In „Odoslané“, and its detail opens though some recipients have no organization.
    const sentList = await jana.call<{ items: { id: string; kind: string }[] }>('campaign.list', {
      status: 'sent',
      page: 1,
    });
    expect(sentList.data.items.find((c) => c.id === id)?.kind).toBe('direct');
    const opened = await jana.call<{ messages: { email: string | null }[] }>('campaign.get', {
      id,
    });
    expect(opened.code).toBeUndefined();
    expect(opened.data.messages).toHaveLength(4);
    // Sent, it is no longer a draft to edit.
    expect((await save([])).code).toBe('CONFLICT');
  });

  it('Nový e-mail: a template comes with its variables written out', async () => {
    const withVariable = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Pre ' },
            { type: 'variable', attrs: { name: 'customer.name' } },
          ],
        },
      ],
    };
    const template = await jana.call<{ id: string }>('template.create', {
      name: `Priamy ${Date.now()}`,
      categoryId: null,
      subject: withVariable,
      body: withVariable,
    });
    const filled = await jana.call<{ subject: string; body: unknown }>(
      'campaign.directFromTemplate',
      { templateId: template.data.id, contactId: EVA, organizationId: HARMONIA },
    );
    expect(filled.code).toBeUndefined();
    expect(filled.data.subject).toContain('ADOS Harmónia');
    expect(JSON.stringify(filled.data.body)).toContain('ADOS Harmónia');
    expect(JSON.stringify(filled.data.body)).not.toContain('"variable"');
  });

  it('a product look: over the global one when on, by the template and the new e-mail', async () => {
    type Looks = { productId: string; name: string; look: Record<string, unknown> }[];
    const looks = (await jana.call<Looks>('template.productLooks')).data;
    const ados = looks.find((p) => p.name === 'ADOS')!;
    const save = (enabled: boolean) =>
      jana.call('template.saveProductLook', {
        productId: ados.productId,
        look: { ...ados.look, enabled, brandName: 'Alma Skuska', footerWeb: 'skuska.example.net' },
      });
    const brandOf = async (productId: string | null) =>
      (await jana.call<{ look: { brandName: string } }>('template.effectiveLook', { productId }))
        .data.look.brandName;

    expect((await save(true)).code).toBeUndefined();
    expect(await brandOf(ados.productId)).toBe('Alma Skuska');
    expect(await brandOf(null)).not.toBe('Alma Skuska');

    // A template wears it, and hands it to the wizard's draft.
    const text = doc('Text');
    const template = await jana.call<{ id: string }>('template.create', {
      name: `S vzhľadom ${Date.now()}`,
      categoryId: null,
      lookProductId: ados.productId,
      subject: doc('Predmet'),
      body: text,
    });
    const shown = await jana.call<{ html: string }>('template.preview', {
      subject: doc('Predmet'),
      body: text,
      lookProductId: ados.productId,
    });
    expect(shown.data.html).toContain('Alma Skuska');
    const id = await draft();
    await jana.call('campaign.chooseTemplate', { id, templateId: template.data.id });
    expect(
      (await jana.call<{ lookProductId: string | null }>('campaign.get', { id })).data
        .lookProductId,
    ).toBe(ados.productId);

    // A direct e-mail goes out in it, under its brand.
    const direct = await jana.call<{ id: string }>('campaign.createDirect');
    await jana.call('campaign.saveDirect', {
      id: direct.data.id,
      recipients: [
        {
          role: 'to',
          email: 'vzhlad@example.net',
          name: null,
          contactId: null,
          organizationId: null,
        },
      ],
      subject: 'So vzhľadom',
      body: text,
      templateId: null,
      lookProductId: ados.productId,
      attachmentFileIds: [],
    });
    await jana.call('campaign.sendDirect', { id: direct.data.id });
    await drainCampaigns(api.db, memoryTransport({ quiet: true }), null, loadEnv());
    const mail = outbox.at(-1)!;
    expect(mail.to).toBe('vzhlad@example.net');
    expect(mail.from).toContain('| Alma Skuska <');
    expect(mail.html).toContain('skuska.example.net');

    // Switched off, the product wears the global look again.
    await save(false);
    expect(await brandOf(ados.productId)).not.toBe('Alma Skuska');
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

    // New is unread; opening one reads the whole conversation; the envelope takes it back.
    const unread = async () =>
      (
        await jana.call<{ items: { id: string; unread: boolean }[] }>('inbound.list', {
          view: 'all',
          search: 'školenia',
        })
      ).data.items[0]!.unread;
    expect(await unread()).toBe(true);
    await jana.call('inbound.markRead', { id: first.id, read: true });
    expect(await unread()).toBe(false);
    await jana.call('inbound.markRead', { id: second.id, read: false });
    expect(await unread()).toBe(true);

    // The bin in a row takes the whole conversation, and only that one.
    await jana.call('inbound.discardThread', { id: second.id });
    const left = await jana.call<{ items: { id: string }[] }>('inbound.list', {
      view: 'all',
      search: 'školenia',
    });
    expect(left.data.items).toEqual([]);
    expect((await jana.call('inbound.get', { id: first.id })).code).toBe('NOT_FOUND');
    expect((await jana.call('inbound.get', { id: other.id })).code).toBeUndefined();
  });
});
