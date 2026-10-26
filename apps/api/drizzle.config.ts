import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// Migrations run as the admin role (owner of the tables); the app runs as intra_app.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? 'postgres://intra_admin:intra_admin@localhost:5434/alma_intra',
  },
  strict: true,
  verbose: true,
});
