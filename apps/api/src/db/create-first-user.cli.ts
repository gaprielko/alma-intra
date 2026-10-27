import { parseArgs } from 'node:util';
import { emailSchema } from '@intra/shared/schemas';
import { z } from 'zod';
import { describeError } from '../logging/describe-error.js';
import { createFirstUser } from './create-first-user.js';
import { createDb } from './db.module.js';

/*
 * pnpm --filter @intra/api users:create-first -- --email <e-mail> --name "<name>"
 * (in the image: node dist/db/create-first-user.cli.js --email … --name …)
 *
 * Works in production. Takes and prints no password and no token: the person gets an invitation
 * by e-mail (sent by the running API's outbox worker) and sets her own password and second
 * factor. It runs outside the API, so it leaves no audit event: the line below, in the log of the
 * shell it was run in, is its trace.
 */
const { values } = parseArgs({
  // pnpm passes the `--` separator through to the script.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { email: { type: 'string' }, name: { type: 'string' } },
});
const input = z
  .object({ email: emailSchema, name: z.string().trim().min(2).max(120) })
  .safeParse(values);
if (!input.success) {
  console.error('Usage: users:create-first -- --email <e-mail> --name "<name>"');
  process.exit(1);
}

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');

const db = createDb(url);
try {
  const result = await createFirstUser(db, input.data);
  const user = 'userId' in result ? ` user ${result.userId}` : '';
  // eslint-disable-next-line no-console -- CLI script, not the server logger
  console.log(`first user bootstrap:${user} ${result.outcome}`);
  if (result.outcome === 'others_exist' || result.outcome === 'deactivated') process.exitCode = 1;
} catch (error) {
  // Name and code only: the message of a failed query carries its parameters, the e-mail and name.
  console.error('first user bootstrap failed:', describeError(error));
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
