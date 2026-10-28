/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The strict CSP: Vite puts `nonce="INTRA_CSP_NONCE"` on every script, modulepreload and
  // stylesheet of index.html and into `<meta property="csp-nonce">` for its preload helper. The API
  // swaps it for a fresh nonce per response (apps/api/src/spa-shell.ts, which refuses a build
  // without it). In dev there is no CSP and the placeholder stays as it is.
  html: { cspNonce: 'INTRA_CSP_NONCE' },
  // Unit tests run in the office's zone on any machine.
  test: { setupFiles: ['./src/test-setup.ts'] },
  server: {
    port: 5180,
    proxy: {
      '/trpc': 'http://localhost:3100',
      '/health': 'http://localhost:3100',
      // The images of e-mails (`/m/<key>`), served by the API.
      '/m/': 'http://localhost:3100',
      // Claude's MCP endpoint and its OAuth metadata, so the address shown in dev works too.
      '/mcp': 'http://localhost:3100',
      '/.well-known': 'http://localhost:3100',
      '/authorize': 'http://localhost:3100',
      '/token': 'http://localhost:3100',
      '/register': 'http://localhost:3100',
      '/revoke': 'http://localhost:3100',
    },
  },
});
