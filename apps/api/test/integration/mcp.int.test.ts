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

  it('reads an organization with its prevádzky and their persons', async () => {
    const parentId = '00000000-0000-4000-8000-d00000000001';
    const created = await jana.call<{ id: string }>('customer.establishmentCreate', {
      parentId,
      establishment: { name: 'Harmónia MCP Spiš' },
      primary: { kind: 'new', contact: { firstName: 'Iveta', lastName: 'Spišská' } },
    });
    const customer = JSON.parse((await tool('customers_get', { customerId: parentId })).text) as {
      establishments: { id: string; persons: { name: string }[] }[];
    };
    const spis = customer.establishments.find((e) => e.id === created.data.id)!;
    expect(spis.persons).toEqual([expect.objectContaining({ name: 'Iveta Spišská' })]);
  });

  describe('e-mail templates', () => {
    const doc = (...content: unknown[]) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content }],
    });
    const text = (value: string) => ({ type: 'text', text: value });
    const variable = (name: string) => ({ type: 'variable', attrs: { name } });
    const auditCount = async (action: string) => {
      const rows = await api.db.execute<{ n: number }>(
        sql`select count(*)::int as n from audit_events
          where action = ${action} and actor_kind = 'claude'`,
      );
      return rows.rows[0]!.n;
    };

    it('creates a template the web can read, finds it, previews it and sends nothing', async () => {
      const made = await tool('templates_create', {
        name: 'Ponuka MCP',
        subject: doc(text('Ponuka pre '), variable('customer.name')),
        body: doc(variable('salutation'), text(' posielame ponuku '), variable('custom.price')),
        customFields: [{ key: 'price', label: 'Cena', type: 'money', scope: 'common' }],
      });
      expect(made.error).toBe(false);
      const { templateId } = JSON.parse(made.text) as { templateId: string };

      const read = await jana.call<{ name: string; active: boolean; categoryId: string | null }>(
        'template.get',
        { id: templateId },
      );
      expect(read.data).toMatchObject({ name: 'Ponuka MCP', active: true, categoryId: null });
      expect(await auditCount('mcp.templates_create')).toBeGreaterThan(0);

      const found = JSON.parse((await tool('templates_search', { query: 'Ponuka MCP' })).text) as {
        templates: { id: string; subject: string }[];
        categories: unknown[];
        products: unknown[];
      };
      expect(found.templates.map((t) => t.id)).toEqual([templateId]);
      expect(found.products.length).toBeGreaterThan(0);

      const shown = JSON.parse(
        (await tool('templates_preview', { templateId, values: { price: '120 €' } })).text,
      ) as { subject: string; text: string; missing: string[] };
      expect(shown.text).toContain('120 €');
      expect(shown.missing).toContain('customer.name');
      expect(shown.missing).not.toContain('custom.price');
    });

    it('changes only the fields it names and switches a template off', async () => {
      const { templateId } = JSON.parse(
        (
          await tool('templates_create', {
            name: 'Zmena MCP',
            subject: doc(text('Predmet')),
            body: doc(text('Pôvodné telo')),
          })
        ).text,
      ) as { templateId: string };

      const changed = await tool('templates_update', {
        templateId,
        changes: { name: 'Zmena MCP 2', active: false },
      });
      expect(JSON.parse(changed.text)).toEqual({
        templateId,
        changed: ['active', 'name'],
      });
      const got = JSON.parse((await tool('templates_get', { templateId })).text) as {
        name: string;
        active: boolean;
        body: unknown;
      };
      expect(got).toMatchObject({ name: 'Zmena MCP 2', active: false });
      expect(JSON.stringify(got.body)).toContain('Pôvodné telo');

      const inactive = JSON.parse(
        (await tool('templates_search', { categoryId: 'inactive' })).text,
      ) as { templates: { id: string }[] };
      expect(inactive.templates.map((t) => t.id)).toContain(templateId);
    });

    it('refuses in words what the editor would not take', async () => {
      const unknown = await tool('templates_create', {
        name: 'Zlá MCP',
        subject: doc(text('Predmet')),
        body: doc(variable('customer.shoeSize')),
      });
      expect(unknown.error).toBe(true);
      expect(unknown.text).toContain('body (unknown_variable)');

      const script = await tool('templates_create', {
        name: 'Zlá MCP',
        subject: doc(text('Predmet')),
        body: { type: 'doc', content: [{ type: 'script', text: 'x' }] },
      });
      expect(script.error).toBe(true);
      expect(script.text).toContain('body.content.0.type');

      const missing = await tool('templates_update', {
        templateId: '00000000-0000-4000-8000-0000000000ff',
        changes: { name: 'Nikde' },
      });
      expect(missing.error).toBe(true);
      expect(missing.text).toContain('templates_search');
    });
  });

  describe('organizations, their persons and prevádzky', () => {
    const history = async (id: string) =>
      (await jana.call<{ action: string }[]>('customer.history', { id })).data.map((e) => e.action);

    it('creates an organization with its first person, and refuses its IČO a second time', async () => {
      const customer = {
        role: 'customer',
        name: 'ADOS MCP s.r.o.',
        ico: '36596612',
        dic: '2022054815',
        street: 'SNP 3961/110',
        postalCode: '075 01',
        city: 'Trebišov',
        tags: ['z-veľtrhu'],
      };
      const made = await tool('customers_create', {
        customer,
        firstContact: { firstName: 'Helena', lastName: 'Mcpová', position: 'sestra' },
      });
      expect(made.error).toBe(false);
      const { customerId } = JSON.parse(made.text) as { customerId: string };
      const read = await jana.call<{
        name: string;
        ico: string;
        pricesWithVat: boolean;
        contacts: { firstName: string; position: string; isPrimary: boolean }[];
      }>('customer.get', { id: customerId });
      expect(read.data).toMatchObject({ name: 'ADOS MCP s.r.o.', ico: '36596612' });
      expect(read.data.contacts[0]).toMatchObject({
        firstName: 'Helena',
        position: 'sestra',
        isPrimary: true,
      });
      expect(await history(customerId)).toContain('mcp.customers_create');

      const again = await tool('customers_create', { customer });
      expect(again.error).toBe(true);
      expect(again.text).toContain('customers_search');
    });

    it('changes only the fields it names and clears one with an empty string', async () => {
      const { customerId } = JSON.parse(
        (
          await tool('customers_create', {
            customer: {
              role: 'customer',
              name: 'ADOS Zmena s.r.o.',
              ico: '36662445',
              web: 'ados-zmena.sk',
              city: 'Považská Bystrica',
              tags: ['ostáva'],
              pricesWithVat: false,
            },
          })
        ).text,
      ) as { customerId: string };
      const updated = await tool('customers_update', {
        customerId,
        changes: { phone: '+421 905 804 125', web: '' },
      });
      expect(updated.error).toBe(false);
      expect(JSON.parse(updated.text).changed.sort()).toEqual(['phone', 'web']);
      const read = await jana.call<{
        name: string;
        ico: string;
        city: string;
        web: string | null;
        phone: string;
        pricesWithVat: boolean;
        role: string;
        tags: { name: string }[];
      }>('customer.get', { id: customerId });
      expect(read.data).toMatchObject({
        name: 'ADOS Zmena s.r.o.',
        ico: '36662445',
        city: 'Považská Bystrica',
        web: null,
        pricesWithVat: false,
        role: 'customer',
      });
      expect(read.data.phone).toContain('905');
      expect(read.data.tags.map((t) => t.name)).toEqual(['ostáva']);
      expect(await history(customerId)).toContain('mcp.customers_update');

      const bad = await tool('customers_update', {
        customerId: '00000000-0000-4000-8000-000000000999',
        changes: { city: 'Nikde' },
      });
      expect(bad.error).toBe(true);
    });

    it('adds and changes a person, keeping what is not named and their unsubscribe', async () => {
      const { customerId } = JSON.parse(
        (
          await tool('customers_create', {
            customer: { role: 'customer', name: 'ADOS Osoby s.r.o.', ico: '36279935' },
          })
        ).text,
      ) as { customerId: string };
      const { contactId } = JSON.parse(
        (
          await tool('contacts_create', {
            customerId,
            contact: {
              titleBefore: 'Mgr.',
              firstName: 'Darina',
              lastName: 'Osobná',
              email: 'darina.osobna@example.sk',
              position: 'konateľka',
            },
          })
        ).text,
      ) as { contactId: string };
      const updated = await tool('contacts_update', {
        contactId,
        customerId,
        changes: { phone: '+421 903 465 338' },
      });
      expect(updated.error).toBe(false);
      expect(JSON.parse(updated.text).changed).toEqual(['phone']);
      const read = await jana.call<{ contacts: Record<string, unknown>[] }>('customer.get', {
        id: customerId,
      });
      expect(read.data.contacts[0]).toMatchObject({
        titleBefore: 'Mgr.',
        email: 'darina.osobna@example.sk',
        position: 'konateľka',
        unsubscribedAt: null,
      });
      expect(await history(customerId)).toEqual(
        expect.arrayContaining(['mcp.contacts_create', 'mcp.contacts_update']),
      );

      const taken = await tool('contacts_create', {
        customerId,
        contact: { firstName: 'Iná', lastName: 'Osoba', email: 'darina.osobna@example.sk' },
      });
      expect(taken.error).toBe(true);
      expect(taken.text).toContain('contacts_search');
    });

    it('adds and changes a prevádzka, told in its organization’s history', async () => {
      const { customerId: parentId } = JSON.parse(
        (
          await tool('customers_create', {
            customer: { role: 'customer', name: 'ADOS Pobočky s.r.o.', ico: '36620505' },
          })
        ).text,
      ) as { customerId: string };
      const made = JSON.parse(
        (
          await tool('establishments_create', {
            parentId,
            establishment: { name: 'ADOS Sečovce', street: 'SNP 807/9', city: 'Sečovce' },
            primary: { kind: 'new', contact: { firstName: 'Eva', lastName: 'Prevádzková' } },
          })
        ).text,
      ) as { establishmentId: string; contactId: string };
      expect(made.contactId).toBeTruthy();
      const updated = await tool('establishments_update', {
        establishmentId: made.establishmentId,
        changes: { postalCode: '078 01' },
      });
      expect(JSON.parse(updated.text).changed).toEqual(['postalCode']);
      const list = await jana.call<{ id: string; street: string; postalCode: string }[]>(
        'customer.establishments',
        { id: parentId },
      );
      expect(list.data[0]).toMatchObject({ street: 'SNP 807/9', postalCode: '078 01' });
      expect(await history(parentId)).toEqual(
        expect.arrayContaining(['mcp.establishments_create', 'mcp.establishments_update']),
      );

      const wrongTool = await tool('customers_update', {
        customerId: made.establishmentId,
        changes: { city: 'Košice' },
      });
      expect(wrongTool.error).toBe(true);
      expect(wrongTool.text).toContain('establishments_update');
    });
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

  it('makes folders and uploads through a signed link, dated by the name', async () => {
    const made = JSON.parse(
      (await tool('files_create_folder', { name: 'Marketing MCP' })).text,
    ) as {
      folderId: string;
      created: boolean;
    };
    expect(made.created).toBe(true);
    const again = JSON.parse((await tool('files_create_folder', { name: 'marketing mcp' })).text);
    expect(again).toEqual({ folderId: made.folderId, created: false });

    const pdf = new TextEncoder().encode('%PDF-1.4 brozura');
    const begun = JSON.parse(
      (
        await tool('files_upload_begin', {
          name: 'Alma ADOS - Brozura 2026-10-19.pdf',
          size: pdf.byteLength,
          folderId: made.folderId,
        })
      ).text,
    ) as { fileId: string; versionId: string; name: string; documentDate: string; url: string };
    expect(begun.name).toBe('Alma ADOS - Brozura.pdf');
    expect(begun.documentDate).toBe('2026-10-19');
    await bucket.storage.put(begun.url.replace('memory://', ''), pdf, 'application/pdf');
    const finished = JSON.parse(
      (await tool('files_upload_finish', { versionId: begun.versionId })).text,
    ) as { number: number };
    expect(finished.number).toBe(1);

    const next = JSON.parse(
      (
        await tool('files_upload_begin', {
          name: 'Alma ADOS - Brozura 2026-10-21.pdf',
          size: pdf.byteLength,
          fileId: begun.fileId,
        })
      ).text,
    ) as { versionId: string; url: string; documentDate: string };
    expect(next.documentDate).toBe('2026-10-21');
    await bucket.storage.put(next.url.replace('memory://', ''), pdf, 'application/pdf');
    await tool('files_upload_finish', { versionId: next.versionId });

    const listed = JSON.parse((await tool('files_list_folder', { folderId: made.folderId })).text)
      .files as { name: string; version: number; documentDate: string }[];
    expect(listed).toEqual([
      expect.objectContaining({
        name: 'Alma ADOS - Brozura.pdf',
        version: 2,
        documentDate: '2026-10-21',
      }),
    ]);

    const inRange = await jana.call<{ files: { id: string }[] }>('file.contents', {
      folderId: made.folderId,
      dateFrom: '2026-10-20',
      dateTo: '2026-10-31',
    });
    expect(inRange.data.files.map((f) => f.id)).toEqual([begun.fileId]);
    const before = await jana.call<{ files: unknown[] }>('file.contents', {
      folderId: made.folderId,
      dateTo: '2026-10-20',
    });
    expect(before.data.files).toEqual([]);
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
