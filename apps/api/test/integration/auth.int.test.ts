import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_PASSWORD } from '../../src/db/seed.js';
import { browser, JANA, PETER, startApi } from './client.js';

describe('sign-in and own account', () => {
  let api: Awaited<ReturnType<typeof startApi>>;

  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(async () => {
    await api.close();
  });

  it('never signs in with the password alone: a second step always follows', async () => {
    const guest = browser(api.baseUrl);
    const first = await guest.call<{ secondStep: { kind: string } | null }>('auth.login', {
      email: JANA,
      password: SEED_PASSWORD,
    });
    expect(first.data.secondStep?.kind).toBe('verify');
    expect((await guest.call('auth.me')).code).toBe('UNAUTHORIZED');
  });

  it('refuses a wrong password and a wrong code without telling which', async () => {
    const guest = browser(api.baseUrl);
    const wrong = await guest.call('auth.login', { email: JANA, password: 'nespravne-heslo-1' });
    expect(wrong.code).toBe('UNAUTHORIZED');
    const first = await guest.call<{ secondStep: { challenge: string } }>('auth.login', {
      email: PETER,
      password: SEED_PASSWORD,
    });
    const code = await guest.call('auth.secondFactorVerify', {
      challenge: first.data.secondStep.challenge,
      code: '000000',
    });
    expect(code.code).toBe('FORBIDDEN');
    expect(code.message).toBe('WRONG_CODE');
  });

  it('signs out: the session cookie no longer works', async () => {
    const jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    expect((await jana.call('auth.me')).code).toBeUndefined();
    await jana.call('auth.logout');
    expect((await jana.call('auth.me')).code).toBe('UNAUTHORIZED');
  });

  it('lists one’s sessions and ends another one', async () => {
    const laptop = browser(api.baseUrl);
    const phone = browser(api.baseUrl);
    await laptop.signIn(PETER);
    await phone.signIn(PETER, 1);
    const sessions =
      await laptop.call<{ sessionId: string; current: boolean }[]>('account.sessions');
    const other = sessions.data.find((s) => !s.current)!;
    await laptop.call('account.endSession', { sessionId: other.sessionId });
    await phone.call('auth.refresh');
    expect((await phone.call('auth.me')).code).toBe('UNAUTHORIZED');
  });
});
