import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { createDb } from './db.module.js';

// Runs in the container before the server starts. drizzle-kit is a dev dependency, so the image
// applies the same SQL files through drizzle-orm; both share the migrations journal. Migrations run
// as the admin role (owner of the tables); the server runs as intra_app.
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('DATABASE_ADMIN_URL is required to migrate');

const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? new URL('./migrations', import.meta.url).pathname;

// drizzle-orm takes no lock: two containers starting at once (a rolling update) must not both
// apply the same migration. A session advisory lock on its own connection serialises them.
const MIGRATION_LOCK = 72_220_922;
const lock = new pg.Client({ connectionString: url });
await lock.connect();
await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
try {
  const db = createDb(url);
  await migrate(db, { migrationsFolder });
  await db.$client.end();
} finally {
  await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]);
  await lock.end();
}
// eslint-disable-next-line no-console -- CLI script, not the server logger
console.log('migrated');
