import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll } from 'vitest';

// Runs in the worker before each test file is imported: the file gets its own database, cloned
// from the migrated and seeded template (`global-setup.ts`). Grants and default privileges come
// with the clone; CONNECT is a database-level grant and is issued again. The URLs are set before
// any pool or Nest module reads them.
const maintenanceUrl = process.env.TEST_DATABASE_MAINTENANCE_URL!;
const database = `intra_t_${process.env.VITEST_POOL_ID ?? '0'}_${randomBytes(6).toString('hex')}`;

async function maintenance(statements: string[]) {
  const client = new pg.Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

await maintenance([
  `CREATE DATABASE ${database} TEMPLATE alma_intra`,
  `GRANT CONNECT ON DATABASE ${database} TO intra_app`,
]);

const adminUrl = new URL(maintenanceUrl);
adminUrl.pathname = `/${database}`;
process.env.DATABASE_ADMIN_URL = adminUrl.href;
adminUrl.username = 'intra_app';
process.env.DATABASE_URL = adminUrl.href;

// Registered first, so it runs after the file's own `afterAll` hooks have closed their pools.
afterAll(async () => {
  try {
    await maintenance([`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
  } catch (error) {
    // Best effort: the container is thrown away at the end of the run anyway.
    console.warn(`test database ${database} was not dropped:`, error);
  }
});
