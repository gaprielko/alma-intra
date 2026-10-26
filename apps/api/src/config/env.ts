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
  MAIL_REPLY_TO: z.union([z.literal(''), z.string().email()]).default('info@adosalma.sk'),
  /** Built `apps/web` served by the API (staging/production image). Unset in dev: Vite serves it. */
  WEB_DIST_DIR: optionalString(z.string().min(1)),
  /**
   * A new password is checked against Have I Been Pwned's range API (only 5 hex characters of its
   * SHA-1 leave the server). `off` checks nothing. Unset means `off` in tests and `hibp`
   * everywhere else. Fail-open either way: HIBP down lets the password through.
   */
  PASSWORD_BREACH_CHECK: optionalString(z.enum(['off', 'hibp'])),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  /** The git commit being served; Coolify sets it at runtime. Reported by /health. */
  SOURCE_COMMIT: optionalString(z.string().min(1)),
});

export type Env = z.infer<typeof envSchema>;

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
  return parsed.data;
}
