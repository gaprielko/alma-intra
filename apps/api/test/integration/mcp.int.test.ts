import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_USERS } from '../../src/db/seed.js';
import { browser, JANA, startApi } from './client.js';
import { memoryStorage } from './memory-storage.js';

describe('Claude through MCP', () => {
  const bucket = memoryStorage();
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let token: string;

  beforeAll(async () => {
    api = await startApi({ storage: bucket.storage });
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    const made = await jana.call<{ token: string }>('account.createAccessToken', {
      name: 'test',
      days: 30,
    });
    token = made.data.token;
  });
  afterAll(async () => {
    await api.close();
  });

  /** One JSON-RPC call to `/mcp`; the answer comes as one server-sent event. */
  async function rpc(method: string, params: unknown, bearer = token) {
    const res = await fetch(`${api.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (res.status !== 200) return { status: res.status, body: null };
    const line = (await res.text()).split('\n').find((l) => l.startsWith('data: '))!;
    return { status: 200, body: JSON.parse(line.slice(6)) as { result: Record<string, unknown> } };
  }
  const tool = async (name: string, args: Record<string, unknown>) => {
    const { body } = await rpc('tools/call', { name, arguments: args });
    const result = body!.result as { content: { text: string }[]; isError?: boolean };
    return { error: result.isError === true, text: result.content[0]!.text };
  };

  it('answers 401 with the resource metadata without a valid token', async () => {
    const res = await fetch(`${api.baseUrl}/mcp`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('oauth-protected-resource');
    expect((await rpc('tools/list', {}, 'intra_pat_wrong')).status).toBe(401);
  });

  it('lists the tools, none of which deletes or sends', async () => {
    const { body } = await rpc('tools/list', {});
    const names = (body!.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain('files_create');
    expect(names.some((n) => /delete|send/.test(n))).toBe(false);
  });

  it('finds a person in Kontakty with their organizations and reads their own timeline', async () => {
    const found = await tool('contacts_search', { query: 'Tóthová' });
    const people = JSON.parse(found.text) as {
      id: string;
      organizations: { name: string; position: string | null }[];
    }[];
    expect(people[0]!.organizations[0]).toMatchObject({ name: 'ADOS Harmónia, s.r.o.' });
    const person = await tool('contacts_get', { contactId: people[0]!.id });
    expect(JSON.parse(person.text)).toHaveProperty('timeline');
  });

  it('finds a customer and writes a file there as a new version, never over it', async () => {
    const found = JSON.parse((await tool('customers_search', { query: 'Harmónia' })).text) as {
      id: string;
    }[];
    const customerId = found[0]!.id;
    const created = JSON.parse(
      (await tool('files_create', { name: 'Poznámky.md', customerId, text: '# v1' })).text,
    ) as { fileId: string };
    const updated = JSON.parse(
      (await tool('files_update', { fileId: created.fileId, text: '# v2', note: 'oprava' })).text,
    ) as { number: number };
    expect(updated.number).toBe(2);
    expect(JSON.parse((await tool('files_read', { fileId: created.fileId })).text).text).toBe(
      '# v2',
    );
  });

  it('refuses content that is not of the type the name says', async () => {
    const refused = await tool('files_create', {
      name: 'falošné.pdf',
      folderId: '00000000-0000-4000-8000-f00000000005',
      text: 'no pdf',
    });
    expect(refused.error).toBe(true);
  });

  it('audits every call as Claude on behalf of the user', async () => {
    const rows = await api.db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_events where action like 'mcp.%' and actor_kind = 'claude'`,
    );
    expect(rows.rows[0]!.n).toBeGreaterThanOrEqual(4);
  });

  it('slows down a runaway: past the limit per user it answers 429 with Retry-After', async () => {
    const key = createHash('sha256').update(`mcp:user:${SEED_USERS.jana}`).digest('hex');
    await api.db.execute(sql`update rate_limits set count = 600 where key = ${key}`);
    const res = await fetch(`${api.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    await api.db.execute(sql`delete from rate_limits where key = ${key}`);
  });

  it('stops working once the token is revoked', async () => {
    const tokens = await jana.call<{ id: string }[]>('account.accessTokens');
    await jana.call('account.revokeAccessToken', { id: tokens.data[0]!.id });
    expect((await rpc('tools/list', {})).status).toBe(401);
  });
});
