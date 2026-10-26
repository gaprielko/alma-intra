import { loadEnv } from '../config/env.js';
import { createDb } from './db.module.js';
import { SEED_PASSWORD, SEED_TOTP_SECRET, seed } from './seed.js';

/*
 * pnpm db:seed: development data with a public password. Refuses to run in production.
 */
const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('The seed creates users with a public password and never runs in production.');
  process.exit(1);
}

const db = createDb(env.DATABASE_ADMIN_URL ?? env.DATABASE_URL);
try {
  await seed(db, env.DATA_ENCRYPTION_KEY);
  // eslint-disable-next-line no-console -- CLI script, not the server logger
  console.log(
    `seeded: jana.horvathova@example.com / ${SEED_PASSWORD}, second factor secret ${SEED_TOTP_SECRET}`,
  );
} finally {
  await db.$client.end();
}
