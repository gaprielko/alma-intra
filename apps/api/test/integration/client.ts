import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { base32Decode, totpAt } from '../../src/auth/totp.js';
import { DB, type Db } from '../../src/db/db.module.js';
import { SEED_PASSWORD, SEED_TOTP_SECRET } from '../../src/db/seed.js';
import { STORAGE } from '../../src/storage/storage.module.js';
import type { Storage } from '../../src/storage/storage.js';

/** The API of this file's database, on a free port; `storage` stands in for the bucket. */
export async function startApi(options: { storage?: Storage } = {}) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.storage) builder.overrideProvider(STORAGE).useValue(options.storage);
  const moduleRef = await builder.compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false, rawBody: true });
  await app.listen(0);
  const baseUrl = await app.getUrl();
  return {
    app,
    baseUrl,
    db: app.get<Db>(DB),
    close: async () => {
      await app.get<Db>(DB).$client.end();
      await app.close();
    },
  };
}

export interface CallResult<T> {
  status: number;
  data: T;
  /** The tRPC code of a refusal (`NOT_FOUND`), and its message (`ICO_TAKEN`). */
  code: string | undefined;
  message: string | undefined;
}

/**
 * A browser of one person: tRPC calls with the cookies the API set, as the web makes them
 * (POST, one call per batch).
 */
export function browser(baseUrl: string) {
  const cookies = new Map<string, string>();
  const keep = (res: Response) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair!.indexOf('=');
      const name = pair!.slice(0, at);
      const value = pair!.slice(at + 1);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
  };
  const call = async <T = unknown>(path: string, input?: unknown): Promise<CallResult<T>> => {
    const res = await fetch(`${baseUrl}/trpc/${path}?batch=1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: JSON.stringify({ 0: input ?? null }),
    });
    keep(res);
    const [answer] = (await res.json()) as [
      { result?: { data: T }; error?: { message: string; data: { code: string } } },
    ];
    return {
      status: res.status,
      data: answer!.result?.data as T,
      code: answer!.error?.data.code,
      message: answer!.error?.message,
    };
  };

  /**
   * Signs a seeded person in: password, then the code of the seed's second factor. A code works
   * once: a second sign-in of the same person within 30 seconds takes the next window's code
   * (`windowOffset: 1`).
   */
  const signIn = async (email: string, windowOffset = 0) => {
    const first = await call<{ secondStep: { kind: string; challenge: string } | null }>(
      'auth.login',
      { email, password: SEED_PASSWORD },
    );
    if (!first.data?.secondStep) throw new Error(`no second step for ${email}: ${first.code}`);
    const code = totpAt(base32Decode(SEED_TOTP_SECRET), Date.now() + windowOffset * 30_000);
    const second = await call('auth.secondFactorVerify', {
      challenge: first.data.secondStep.challenge,
      code,
    });
    if (second.code) throw new Error(`second factor refused for ${email}: ${second.message}`);
  };

  return { call, signIn, cookies };
}

export const JANA = 'jana.horvathova@example.com';
export const PETER = 'peter.kovac@example.com';
