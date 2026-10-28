import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

describe('the harness', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(async () => {
    await api.close();
  });

  it('signs a seeded colleague in with password and code', async () => {
    const jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    const me = await jana.call<{ email: string }>('auth.me');
    expect(me.data.email).toBe(JANA);
  });

  it('refuses a call without a session', async () => {
    const nobody = browser(api.baseUrl);
    expect((await nobody.call('customer.list', {})).code).toBe('UNAUTHORIZED');
  });
});
