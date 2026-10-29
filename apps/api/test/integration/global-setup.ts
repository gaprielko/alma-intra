import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as schema from '../../src/db/schema/index.js';
import { seed } from '../../src/db/seed.js';

let container: StartedPostgreSqlContainer;

/**
 * One Postgres per test run. The `alma_intra` database gets the roles, the migrations and the
 * seed once and is then frozen as a template; every test file clones its own database from it
 * (`database-per-file.ts`), so no file sees rows another file wrote.
 */
export async function setup() {
  container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('alma_intra')
    .withUsername('intra_admin')
    .withPassword('intra')
    // Files run in parallel, each with its own pools; nothing here has to survive a crash.
    .withCommand(['postgres', '-c', 'max_connections=300', '-c', 'fsync=off'])
    .start();

  // Test-only values so modules that validate the whole environment can boot. No key for the
  // mail provider: a test never reaches Resend; no bucket: the file tests bring their own fake.
  process.env.NODE_ENV = 'test';
  process.env.AUTH_ACCESS_SECRET = 'integration-test-access-secret-0123456789';
  process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.PASSWORD_BREACH_CHECK = 'off';
  // Only what goes wrong: the request log of every call would bury the test output.
  process.env.LOG_LEVEL = 'error';
  delete process.env.RESEND_API_KEY;
  delete process.env.INBOUND_REPLY_DOMAIN;

  const templateUrl = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: templateUrl });
  await pool.query(readFileSync(new URL('../../db/init/01-roles.sql', import.meta.url), 'utf8'));
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../../src/db/migrations', import.meta.url)),
  });
  await seed(drizzle(pool, { schema }), process.env.DATA_ENCRYPTION_KEY);
  await pool.end();

  // CREATE DATABASE … TEMPLATE refuses a template with open connections: close ours, forbid new ones.
  const maintenanceUrl = new URL(templateUrl);
  maintenanceUrl.pathname = '/postgres';
  const maintenance = new pg.Client({ connectionString: maintenanceUrl.href });
  await maintenance.connect();
  await maintenance.query(
    'ALTER DATABASE alma_intra WITH is_template true ALLOW_CONNECTIONS false',
  );
  await maintenance.end();

  process.env.TEST_DATABASE_MAINTENANCE_URL = maintenanceUrl.href;
}

export async function teardown() {
  await container.stop();
}
