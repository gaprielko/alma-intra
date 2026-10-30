import { z } from 'zod';

/** The value from `.env.example`, or something typed by hand instead of generated. */
const isWeakSecret = (value: string) => /change-me/i.test(value) || new Set(value).size < 16;

/** An empty value in `.env` (`RESEND_API_KEY=`) means "not set". */
const optionalString = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3100),
  DATABASE_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url().optional(),
  /** Signs access tokens. Generate with `openssl rand -base64 48`. */
  AUTH_ACCESS_SECRET: z.string().min(32),
  /** 32 random bytes, base64. Encrypts the second-factor secrets at rest. */
  DATA_ENCRYPTION_KEY: z.string().min(40),
  AUTH_ACCESS_TTL: z.string().default('15m'),
  /** Base URL of the web app; e-mail links point here. */
  WEB_URL: z.string().url().default('http://localhost:5180'),
  /** Without a key, e-mails are kept in an in-memory outbox instead of being sent (dev and tests only). */
  RESEND_API_KEY: optionalString(z.string().min(1)),
  MAIL_FROM: z.string().default('Alma Intra <onboarding@resend.dev>'),
  /** Where an answer to a system e-mail goes. Empty sends no Reply-To. Checked at boot. */
  MAIL_REPLY_TO: z.union([z.literal(''), z.string().email()]).default('info@alma-care.eu'),
  /**
   * The shared sending address of e-mails to organizations (D-17a): the From shows the colleague's
   * name with it. Its domain must be verified in Resend.
   */
  /**
   * The signing secret of the Resend webhook (`whsec_…`) that reports delivery, bounces and
   * complaints. Unset, the webhook answers 503 and messages stay „Odoslaný“.
   */
  RESEND_WEBHOOK_SECRET: optionalString(z.string().min(10)),
  /**
   * Verifies what Alma ADOS sends about its podnety (docs/activities-from-apps.md); the same value as
   * its FEEDBACK_OUTBOUND_SECRET. Unset, those routes answer 503 and Alma keeps trying for a day.
   */
  ALMA_OUTBOUND_SECRET: optionalString(z.string().min(32)),
  CAMPAIGN_FROM_ADDRESS: z.string().email().default('info@mail.alma-care.eu'),
  /**
   * The domain Resend receives mail for (spec 6.6): each e-mail to a customer gets the Reply-To
   * `r+<token>@<domain>`, and the reply comes back through the webhook. Unset, the Reply-To is
   * the sender's own mailbox and no reply reaches Intra.
   */
  INBOUND_REPLY_DOMAIN: optionalString(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)),
  /** Built `apps/web` served by the API (staging/production image). Unset in dev: Vite serves it. */
  WEB_DIST_DIR: optionalString(z.string().min(1)),
  /**
   * A new password is checked against Have I Been Pwned's range API (only 5 hex characters of its
   * SHA-1 leave the server). `off` checks nothing. Unset means `off` in tests and `hibp`
   * everywhere else. Fail-open either way: HIBP down lets the password through.
   */
  PASSWORD_BREACH_CHECK: optionalString(z.enum(['off', 'hibp'])),
  /**
   * S3-compatible object storage for the Files module (Hetzner Object Storage in production,
   * SeaweedFS locally). All five or none: unset, the file procedures answer PRECONDITION_FAILED
   * and the web says the files are not set up. Required in production.
   */
  S3_ENDPOINT: optionalString(z.string().url()),
  S3_REGION: optionalString(z.string().min(1)),
  S3_BUCKET: optionalString(z.string().min(1)),
  S3_ACCESS_KEY_ID: optionalString(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: optionalString(z.string().min(1)),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  /** The git commit being served; Coolify sets it at runtime. Reported by /health. */
  SOURCE_COMMIT: optionalString(z.string().min(1)),
});

export type Env = z.infer<typeof envSchema>;

/** The S3 variables, or `null` when none is set. */
export type StorageEnv = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function storageEnvOf(env: Env): StorageEnv | null {
  const values = {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
  if (missing.length === Object.keys(values).length) return null;
  if (missing.length > 0) {
    throw new Error(
      `Invalid environment: S3 storage is half configured, missing ${missing.join(', ')}`,
    );
  }
  return values as StorageEnv;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  // Development runs on the values from `.env.example`; production must not.
  if (parsed.data.NODE_ENV === 'production' && isWeakSecret(parsed.data.AUTH_ACCESS_SECRET)) {
    throw new Error(
      'Invalid environment: AUTH_ACCESS_SECRET is a placeholder, generate a real one',
    );
  }
  // Half a storage configuration is a typo, not a choice: fail at startup, not at the first upload.
  const storage = storageEnvOf(parsed.data);
  if (parsed.data.NODE_ENV === 'production' && storage) {
    if (!storage.endpoint.startsWith('https:')) {
      throw new Error('Invalid environment: S3_ENDPOINT must use https in production');
    }
    if (isWeakSecret(storage.secretAccessKey)) {
      throw new Error('Invalid environment: S3_SECRET_ACCESS_KEY is a placeholder, use a real key');
    }
  }
  return parsed.data;
}
