import { ACTIVITY_TYPE_FEEDBACK_ID } from '@intra/shared/schemas';
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
