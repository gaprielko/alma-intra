import { loadEnv, storageEnvOf } from '../config/env.js';
import { setBucketCors } from './storage.js';

// The browser uploads and downloads files straight from the bucket via signed URLs, so the bucket
// must allow the web's origin. Run once per environment, inside the app container, which already
// has the S3 variables: `node dist/storage/bucket-cors.cli.js`.
const env = loadEnv();
const storage = storageEnvOf(env);
if (!storage) throw new Error('S3 storage is not configured');
await setBucketCors(storage, env.WEB_URL);
// eslint-disable-next-line no-console -- CLI script, not the server logger
console.log(`CORS set on ${storage.bucket} for ${new URL(env.WEB_URL).origin}`);
