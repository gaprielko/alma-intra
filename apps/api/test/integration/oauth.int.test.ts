import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, JANA, startApi } from './client.js';

const REDIRECT = 'http://localhost:9999/callback';

describe('OAuth for Claude (claude.ai, Desktop, Code)', () => {
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

  const form = (body: Record<string, string>) =>
    fetch(`${api.baseUrl}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    }).then(async (res) => ({
      status: res.status,
      json: (await res.json()) as Record<string, string>,
    }));

  const toolsList = (token: string) =>
    fetch(`${api.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }).then((res) => res.status);

  it('registers, asks the user, exchanges the code once and rotates the refresh token', async () => {
    const registered = (await (
      await fetch(`${api.baseUrl}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }),
      })
    ).json()) as { client_id: string };

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorize = new URL(`${api.baseUrl}/authorize`);
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: registered.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    })) {
      authorize.searchParams.set(key, value);
    }
    const toConsent = await fetch(authorize, { redirect: 'manual' });
    const request = new URL(toConsent.headers.get('location')!).searchParams.get('request')!;

    const shown = await jana.call<{ clientName: string }>('oauth.request', { request });
    expect(shown.data.clientName).toBe('Claude');
    const decided = await jana.call<{ redirectTo: string }>('oauth.decide', {
      request,
      approve: true,
    });
    const back = new URL(decided.data.redirectTo);
    expect(back.searchParams.get('state')).toBe('xyz');
    const code = back.searchParams.get('code')!;

    const exchange = {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: registered.client_id,
      redirect_uri: REDIRECT,
    };
    const tokens = await form(exchange);
    expect(tokens.status).toBe(200);
    expect(await toolsList(tokens.json.access_token!)).toBe(200);
    expect((await form(exchange)).status).toBe(400);

    const refresh = {
      grant_type: 'refresh_token',
      refresh_token: tokens.json.refresh_token!,
      client_id: registered.client_id,
    };
    expect((await form(refresh)).status).toBe(200);
    expect((await form(refresh)).status).toBe(400);
    expect(await toolsList(tokens.json.access_token!)).toBe(401);
  });

  it('a refused request goes back with access_denied', async () => {
    const registered = (await (
      await fetch(`${api.baseUrl}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
      })
    ).json()) as { client_id: string };
    const authorize = new URL(`${api.baseUrl}/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: registered.client_id,
      redirect_uri: REDIRECT,
      code_challenge: createHash('sha256').update('v'.repeat(43)).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    const toConsent = await fetch(authorize, { redirect: 'manual' });
    const request = new URL(toConsent.headers.get('location')!).searchParams.get('request')!;
    const decided = await jana.call<{ redirectTo: string }>('oauth.decide', {
      request,
      approve: false,
    });
    expect(new URL(decided.data.redirectTo).searchParams.get('error')).toBe('access_denied');
    expect((await jana.call('oauth.request', { request })).code).toBe('NOT_FOUND');
  });
});
