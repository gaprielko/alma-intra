import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests of the web's own logic (helpers, wording), without a browser: the screens are
// covered by the Playwright end-to-end tests.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
