import {
  ACTIVITY_TYPE_FEEDBACK_ID,
  ACTIVITY_TYPE_INTEREST_ID,
  ADOS_PRODUCT_ID,
} from '@intra/shared/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

describe('the types of Aktivity', () => {
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

  const fields = { confirmLabel: 'Áno', asksProduct: false, active: true };

  it('refuses a name taken, and removes a type used nowhere', async () => {
    const made = await jana.call<{ id: string }>('activityType.create', {
      name: 'Žiadosť o demo',
      ...fields,
    });
    expect(made.code).toBeUndefined();
    const again = await jana.call('activityType.create', { name: 'Žiadosť o demo', ...fields });
    expect(again.message).toBe('NAME_TAKEN');
    expect((await jana.call('activityType.delete', { id: made.data.id })).code).toBeUndefined();
  });

  it('keeps a type of the system', async () => {
    const refused = await jana.call('activityType.delete', { id: ACTIVITY_TYPE_FEEDBACK_ID });
    expect(refused.message).toBe('SYSTEM_ITEM');
  });

  it('a type without a button: no label, no product, and it can get a button later', async () => {
    type Row = { id: string; confirmLabel: string | null; asksProduct: boolean };
    const made = await jana.call<{ id: string }>('activityType.create', {
      name: 'Bez tlačidla',
      confirmLabel: null,
      asksProduct: true,
      active: true,
    });
    expect(made.code).toBeUndefined();
    const row = async () =>
      (await jana.call<Row[]>('activityType.list')).data.find((t) => t.id === made.data.id)!;
    expect(await row()).toMatchObject({ confirmLabel: null, asksProduct: false });
    await jana.call('activityType.update', { id: made.data.id, name: 'Bez tlačidla', ...fields });
    expect((await row()).confirmLabel).toBe('Áno');
    await jana.call('activityType.update', {
      id: made.data.id,
      name: 'Bez tlačidla',
      ...fields,
      confirmLabel: null,
    });
    expect((await row()).confirmLabel).toBeNull();
    await jana.call('activityType.delete', { id: made.data.id });
  });

  it('interest is an ordinary type: held by a button it stays, freed it goes', async () => {
    type Row = { id: string; system: boolean; inTemplates: number };
    const row = async () =>
      (await jana.call<Row[]>('activityType.list')).data.find(
        (t) => t.id === ACTIVITY_TYPE_INTEREST_ID,
      );
    expect((await row())!.system).toBe(false);
    const body = (attrs: Record<string, unknown>) => ({
      type: 'doc',
      content: [{ type: 'button', attrs: { text: 'A', ...attrs } }],
    });
    // A document older than the types holds it by its product.
    const old = await api.db.execute<{ id: string }>(sql`
      insert into email_templates (name, subject, body)
      values ('Stará', ${JSON.stringify(body({}))}::jsonb,
        ${JSON.stringify(body({ interestProductId: ADOS_PRODUCT_ID }))}::jsonb)
      returning id`);
    expect((await row())!.inTemplates).toBe(1);
    const refused = await jana.call('activityType.delete', { id: ACTIVITY_TYPE_INTEREST_ID });
    expect(refused.message).toBe('IN_USE');
    const off = await jana.call('activityType.update', {
      id: ACTIVITY_TYPE_INTEREST_ID,
      name: 'Záujem o produkt',
      ...fields,
      confirmLabel: null,
    });
    expect(off.message).toBe('IN_USE');
    await api.db.execute(
      sql`update email_templates set body = ${JSON.stringify(
        body({ href: 'https://alma-care.eu' }),
      )}::jsonb where id = ${old.rows[0]!.id}`,
    );
    expect(
      (await jana.call('activityType.delete', { id: ACTIVITY_TYPE_INTEREST_ID })).code,
    ).toBeUndefined();
    expect(await row()).toBeUndefined();
  });

  it('keeps a type a button in a template holds', async () => {
    const made = await jana.call<{ id: string }>('activityType.create', {
      name: 'V šablóne',
      ...fields,
    });
    const doc = (attrs: Record<string, unknown>) => ({
      type: 'doc',
      content: [{ type: 'button', attrs }],
    });
    await api.db.execute(sql`
      insert into email_templates (name, subject, body)
      values ('T', ${JSON.stringify(doc({}))}::jsonb,
        ${JSON.stringify(doc({ text: 'A', activityTypeId: made.data.id }))}::jsonb)`);
    const refused = await jana.call('activityType.delete', { id: made.data.id });
    expect(refused.message).toBe('IN_USE');
  });
});
