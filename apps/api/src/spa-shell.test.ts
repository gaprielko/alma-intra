import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { securityHeaders } from './security-headers.js';
import { CSP_NONCE_PLACEHOLDER, serveWeb, shellTemplate } from './spa-shell.js';

/** index.html as `vite build` writes it with `html.cspNonce` (apps/web/vite.config.ts). */
const builtIndex = (placeholder = CSP_NONCE_PLACEHOLDER) => `<!doctype html>
<html lang="sk">
  <head>
    <meta charset="UTF-8" />
    <title>Alma</title>
    <script type="module" crossorigin src="/assets/index-Ab12Cd34.js" nonce="${placeholder}"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-Ef56Gh78.js" nonce="${placeholder}">
    <link rel="stylesheet" crossorigin href="/assets/index-Ij90Kl12.css" nonce="${placeholder}">
    <meta property="csp-nonce" nonce="${placeholder}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

/** The first bytes of an ICO file (reserved 0, type 1 = icon, one image), enough for a fixture. */
const ICO = Buffer.from([0, 0, 1, 0, 1, 0]);

function webDist(index: string, { favicon = true } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'alma-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), index);
  writeFileSync(join(dir, 'assets', 'index-Ab12Cd34.js'), 'export {};\n');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  if (favicon) writeFileSync(join(dir, 'favicon.ico'), ICO);
  return dir;
}

const nonceOf = (res: Response) =>
  /script-src 'nonce-([^']+)'/.exec(res.headers.get('content-security-policy') ?? '')?.[1];

/** A GET of `path` exactly as written: no URL parser normalizes it on the way. */
function rawGet(baseUrl: string, path: string) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
    (done, fail) => {
      request({ hostname, port, path, method: 'GET' }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body }));
      })
        .on('error', fail)
        .end();
    },
  );
}

/** The start tags a nonce gates: scripts and module preloads. */
const scriptTags = (html: string) =>
  html.match(/<script\b[^>]*>|<link\b[^>]*rel="modulepreload"[^>]*>/g) ?? [];

describe('the SPA shell with its CSP nonce', () => {
  let app: NestExpressApplication;
  let dir: string;
  let baseUrl: string;

  beforeAll(async () => {
    dir = webDist(builtIndex());
    const moduleRef = await Test.createTestingModule({}).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    // As main.ts wires it: the headers (and the nonce) first, then the web.
    app.use(securityHeaders());
    serveWeb(app, dir);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(['/', '/users', '/customers/0b9f2c3e-1111-4a4a-8888-123456789abc', '/index.html'])(
    'serves %s with the nonce of its own header on every script tag, never stored',
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const nonce = nonceOf(res)!;
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      const html = await res.text();
      const tags = scriptTags(html);
      expect(tags).toHaveLength(2);
      for (const tag of tags) expect(tag).toContain(` nonce="${nonce}"`);
      // Vite's preload helper reads it from here for the chunks it adds later.
      expect(html).toContain(`<meta property="csp-nonce" nonce="${nonce}">`);
      expect(html).not.toContain(CSP_NONCE_PLACEHOLDER);
      // No host in script-src: what runs is what carries the nonce, or what that added.
      const scriptSrc = /script-src ([^;]*)/.exec(res.headers.get('content-security-policy')!)![1];
      expect(scriptSrc).toBe(`'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`);
    },
  );

  it('gives every response a nonce of its own', async () => {
    const pages = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const res = await fetch(`${baseUrl}/users`);
        return { nonce: nonceOf(res)!, html: await res.text() };
      }),
    );
    expect(new Set(pages.map((p) => p.nonce)).size).toBe(10);
    for (const { nonce, html } of pages) {
      expect(html.match(/nonce="([^"]+)"/g)!.every((a) => a === `nonce="${nonce}"`)).toBe(true);
    }
  });

  it('answers HEAD for the shell without a body', async () => {
    const res = await fetch(`${baseUrl}/users`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });

  it('keeps the hashed assets long-cached, and a missing one is a 404, not the shell', async () => {
    const asset = await fetch(`${baseUrl}/assets/index-Ab12Cd34.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const gone = await fetch(`${baseUrl}/assets/index-0ld0ne00.js`);
    expect(gone.status).toBe(404);
    expect(await gone.text()).not.toContain('<div id="root">');
  });

  // Browsers ask for /favicon.ico on their own.
  it('serves /favicon.ico as the icon, cached for a week, not the shell', async () => {
    const res = await fetch(`${baseUrl}/favicon.ico`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\//);
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(ICO);
    const head = await fetch(`${baseUrl}/favicon.ico`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toMatch(/^image\//);
  });

  it('answers /favicon.ico with a 404, not the shell, when the build has none', async () => {
    const bare = webDist(builtIndex(), { favicon: false });
    const moduleRef = await Test.createTestingModule({}).compile();
    const other = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    try {
      other.use(securityHeaders());
      serveWeb(other, bare);
      await other.listen(0, '127.0.0.1');
      const res = await fetch(`${await other.getUrl()}/favicon.ico`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('<div id="root">');
    } finally {
      await other.close();
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('serves no file from the root of dist, only from /assets/', async () => {
    const stray = await fetch(`${baseUrl}/favicon.svg`);
    expect(stray.status).toBe(404);
    expect(await stray.text()).not.toContain('<svg');
  });

  // Review of #183: under a static server over the root of dist, other spellings of index.html
  // got the raw file, its placeholder unreplaced. Sent as written (fetch would normalize them).
  it.each([
    '//index.html',
    '/%69ndex.html',
    '/%2Findex.html',
    '/./index.html',
    '/assets/../index.html',
    '/assets/%2e%2e/index.html',
    '/assets/..%2Findex.html',
    '/assets//../index.html',
    '/index.html/',
  ])('never serves %s as the raw file: the shell with its nonce, or no page', async (path) => {
    const { status, headers, body } = await rawGet(baseUrl, path);
    expect(body).not.toContain(CSP_NONCE_PLACEHOLDER);
    if (status === 200) {
      const nonce = /script-src 'nonce-([^']+)'/.exec(String(headers['content-security-policy']))!;
      expect(body).toContain(`nonce="${nonce[1]}"`);
      expect(headers['cache-control']).toBe('no-store');
    } else {
      expect([400, 403, 404]).toContain(status);
      expect(body).not.toContain('<div id="root">');
    }
  });

  it.each(['/trpc/health.ping', '/health'])('leaves %s to Nest', async (path) => {
    // No controllers in this app: Nest's 404, not the shell.
    const res = await fetch(`${baseUrl}${path}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<div id="root">');
  });

  it('refuses a build whose scripts do not carry the placeholder', () => {
    const plain = webDist(builtIndex().replaceAll(` nonce="${CSP_NONCE_PLACEHOLDER}"`, ''));
    const partly = webDist(
      builtIndex().replace(`<div id="root"></div>`, `<div id="root"></div><script src="/x.js">`),
    );
    const other = webDist(builtIndex('SOMETHING_ELSE'));
    const preload = webDist(
      builtIndex().replace(
        '</head>',
        '<link rel="modulepreload" crossorigin href="/assets/x-1.js">\n  </head>',
      ),
    );
    const bads = [plain, partly, other, preload];
    try {
      for (const bad of bads) expect(() => shellTemplate(bad)).toThrow(/html\.cspNonce/);
      // The fixture itself passes.
      expect(shellTemplate(dir)('n')).toContain('nonce="n"');
    } finally {
      for (const bad of bads) rmSync(bad, { recursive: true, force: true });
    }
  });
});
