import { createHmac, randomUUID } from 'node:crypto';
import { ACTIVITY_TYPE_FEEDBACK_ID, ADOS_PRODUCT_ID } from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';
import { memoryStorage } from './memory-storage.js';

const SECRET = 'a'.repeat(48);
const HARMONIA = '00000000-0000-4000-8000-d00000000001';
const SECRET_TEXT = 'Pacientka Nováková, diagnóza X';

interface Entry {
  id: string;
  typeId: string;
  source: string;
  productId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  contactId: string | null;
  reporterName: string | null;
  sourceOrganizationName: string | null;
  feedbackKind: string | null;
}

describe('podnety from Alma ADOS', () => {
  const bucket = memoryStorage();
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let evaEmail: string;
  let evaId: string;

  const item = (overrides: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    createdAt: '2026-10-30T09:14:03.512Z',
    type: 'idea',
    whatDoing: SECRET_TEXT,
    expected: '',
    reporter: { userId: randomUUID(), name: 'Eva', email: evaEmail, role: 'nurse' },
    organization: { id: HARMONIA, name: 'V Alme' },
    app: { client: 'web', version: 'abc', build: null, commit: null },
    device: { os: 'macOS', model: null, network: '4g' },
    place: { screen: '/plan', params: {}, point: null, element: null, heading: 'Plánovanie' },
    trail: [],
    apiCalls: [],
    errors: [],
    pendingSync: null,
    screenshot: null,
    ...overrides,
  });

  const post = (path: string, body: unknown, secret = SECRET) => {
    const raw = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    return fetch(`${api.baseUrl}/api/integrations/ados/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Alma-Timestamp': String(timestamp),
        'X-Alma-Signature': `sha256=${signature}`,
      },
      body: raw,
    });
  };

  const entryOf = async (feedbackId: string) => {
    const rows = await api.db.execute<{ id: string }>(
      sql`select id from lead_activities where app_feedback_id = ${feedbackId}`,
    );
    const id = rows.rows[0]?.id;
    return id ? (await jana.call<Entry>('leadActivity.get', { id })).data : null;
  };

  beforeAll(async () => {
    process.env.ALMA_OUTBOUND_SECRET = SECRET;
    api = await startApi({ storage: bucket.storage });
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    const rows = await api.db.execute<{ id: string; email: string }>(
      sql`select id, email from contacts where email is not null and deleted_at is null limit 1`,
    );
    evaId = rows.rows[0]!.id;
    evaEmail = rows.rows[0]!.email;
  });
  afterAll(async () => {
    await api.close();
  });

  it('refuses a bad signature', async () => {
    const response = await post('feedback', item(), 'b'.repeat(48));
    expect(response.status).toBe(401);
  });

  it('records an entry with the product, the organization and the contact', async () => {
    const sent = item();
    expect((await post('feedback', sent)).status).toBe(201);
    const entry = await entryOf(sent.id);
    expect(entry).toMatchObject({
      typeId: ACTIVITY_TYPE_FEEDBACK_ID,
      source: 'app',
      productId: ADOS_PRODUCT_ID,
      organizationId: HARMONIA,
      contactId: evaId,
      feedbackKind: 'idea',
    });
  });

  it('stores one item for a repeated request, and every podnet apart', async () => {
    const sent = item();
    expect((await post('feedback', sent)).status).toBe(201);
    expect((await post('feedback', sent)).status).toBe(201);
    const same = await api.db.execute<{ count: number }>(
      sql`select count(*)::int as count from lead_activities where app_feedback_id = ${sent.id}`,
    );
    expect(same.rows[0]!.count).toBe(1);
    const other = item();
    expect((await post('feedback', other)).status).toBe(201);
    expect((await entryOf(other.id))?.id).not.toBe((await entryOf(sent.id))?.id);
  });

  it('matches a prevádzka or an organization by the id in Alma too', async () => {
    const almaId = randomUUID();
    await api.db.execute(
      sql`update organizations set alma_organization_id = ${almaId} where id = ${HARMONIA}`,
    );
    const sent = item({ organization: { id: almaId, name: 'V Alme' } });
    expect((await post('feedback', sent)).status).toBe(201);
    expect((await entryOf(sent.id))?.organizationId).toBe(HARMONIA);
  });

  it('keeps an item without a match, and it can be assigned by hand', async () => {
    const sent = item({
      organization: { id: randomUUID(), name: 'Neznáma' },
      reporter: { userId: null, name: 'Nikto', email: 'nikto@example.com', role: 'nurse' },
    });
    expect((await post('feedback', sent)).status).toBe(201);
    const entry = await entryOf(sent.id);
    expect(entry).toMatchObject({
      organizationId: null,
      contactId: null,
      reporterName: 'Nikto',
      sourceOrganizationName: 'Neznáma',
    });
    const list = await jana.call<{ items: Entry[] }>('leadActivity.list', { search: 'Nikto' });
    expect(list.data.items.map((row) => row.id)).toContain(entry!.id);
    const assigned = await jana.call('leadActivity.assign', {
      id: entry!.id,
      organizationId: HARMONIA,
    });
    expect(assigned.code).toBeUndefined();
    expect((await entryOf(sent.id))?.organizationId).toBe(HARMONIA);
  });

  it('accepts a picture up to the contract, under a key of ids', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(399_000, 1)]);
    const sent = item({
      screenshot: {
        contentType: 'image/jpeg',
        width: 10,
        height: 10,
        dataBase64: jpeg.toString('base64'),
      },
    });
    expect((await post('feedback', sent)).status).toBe(201);
    const entry = await entryOf(sent.id);
    const content = await jana.call<{ screenshotUrl: string | null }>('leadActivity.feedback', {
      id: entry!.id,
    });
    expect(content.data.screenshotUrl).toContain(`feedback/${sent.id}/screen.jpg`);
  });

  it('shows the text only in the detail, and records who read it', async () => {
    const sent = item();
    await post('feedback', sent);
    const entry = await entryOf(sent.id);
    expect(JSON.stringify(entry)).not.toContain(SECRET_TEXT);
    const timeline = await jana.call<unknown>('activity.timeline', { customerId: HARMONIA });
    expect(JSON.stringify(timeline.data)).toContain('"source":"app"');
    expect(JSON.stringify(timeline.data)).not.toContain(SECRET_TEXT);
    const content = await jana.call<{ whatDoing: string }>('leadActivity.feedback', {
      id: entry!.id,
    });
    expect(content.data.whatDoing).toBe(SECRET_TEXT);
    const reads = await api.db.execute<{ count: number }>(
      sql`select count(*)::int as count from audit_events
        where action = 'leadActivity.feedback' and kind = 'read' and entity_id = ${entry!.id}`,
    );
    expect(reads.rows[0]!.count).toBe(1);
    const trail = await api.db.execute<{ text: string }>(
      sql`select coalesce(string_agg(diff::text, ' '), '') as text from audit_events`,
    );
    expect(trail.rows[0]!.text).not.toContain(SECRET_TEXT);
  });

  it('keeps a reply and a confirmation once, and refuses them for an unknown item', async () => {
    const sent = item();
    await post('feedback', sent);
    const reply = {
      id: randomUUID(),
      feedbackId: sent.id,
      createdAt: '2026-10-30T10:00:00.000Z',
      body: 'Ešte toto',
      statusAfter: null,
    };
    expect((await post(`feedback/${sent.id}/messages`, reply)).status).toBe(201);
    expect((await post(`feedback/${sent.id}/messages`, reply)).status).toBe(201);
    const answer = {
      id: randomUUID(),
      feedbackId: sent.id,
      createdAt: '2026-10-30T11:00:00.000Z',
      works: false,
      body: null,
      statusAfter: 'reviewing',
      resolvedEventId: 'evt_1',
    };
    expect((await post(`feedback/${sent.id}/confirmation`, answer)).status).toBe(201);
    const entry = await entryOf(sent.id);
    const content = await jana.call<{ events: { kind: string }[] }>('leadActivity.feedback', {
      id: entry!.id,
    });
    expect(content.data.events.map((event) => event.kind)).toEqual(['message', 'confirmation']);
    const unknown = randomUUID();
    const refused = await post(`feedback/${unknown}/messages`, { ...reply, feedbackId: unknown });
    expect(refused.status).toBe(404);
  });

  it('keeps the item when its entry was removed from Aktivity', async () => {
    const sent = item();
    await post('feedback', sent);
    const entry = await entryOf(sent.id);
    expect((await jana.call('leadActivity.delete', { id: entry!.id })).code).toBeUndefined();
    const reply = {
      id: randomUUID(),
      feedbackId: sent.id,
      createdAt: '2026-10-30T10:00:00.000Z',
      body: 'Ešte',
    };
    expect((await post(`feedback/${sent.id}/messages`, reply)).status).toBe(201);
  });
});
