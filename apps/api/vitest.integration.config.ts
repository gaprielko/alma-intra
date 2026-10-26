import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/integration/**/*.int.test.ts'],
    globalSetup: ['./test/integration/global-setup.ts'],
    setupFiles: ['./test/integration/database-per-file.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
