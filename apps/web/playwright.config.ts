import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests of the screens, in Chromium, against a running app with the seed data:
 * `pnpm dev` (API :3100, web :5180) after `pnpm db:seed`, or `E2E_BASE_URL` for another one.
 * `e2e/sign-in.setup.ts` signs the seed's Jana in once (password and a TOTP code) and the tests
 * reuse that session: a code works only once.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5180',
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'sign-in', testMatch: /sign-in\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/jana.json' },
      dependencies: ['sign-in'],
      testIgnore: /\.setup\.ts/,
    },
  ],
});
