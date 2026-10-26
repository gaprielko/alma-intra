import { existsSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { CspLocals } from './security-headers.js';

/**
 * What apps/web/vite.config.ts gives Vite as `html.cspNonce`. Vite writes `nonce="<this>"` onto
 * every `<script>`, `<link rel=modulepreload>` and stylesheet of the built index.html, and into a
 * `<meta property="csp-nonce">` that its preload helper reads for the chunks it preloads later.
 * The shell swaps it for the response's nonce; it never reaches a browser as it is.
 */
export const CSP_NONCE_PLACEHOLDER = 'INTRA_CSP_NONCE';

const NONCE_ATTRIBUTE = `nonce="${CSP_NONCE_PLACEHOLDER}"`;

/** Served by Nest, never the shell. */
const API_PREFIXES = ['/trpc', '/health'];

/**
 * The one file served from the root of dist: apps/web/public/favicon.ico, which Vite copies
 * there as it is. Browsers ask for it on their own. Its name
 * never changes, so it is cached for a week rather than forever.
 */
const FAVICON = '/favicon.ico';
const FAVICON_MAX_AGE = '7d';

/**
 * Reads index.html once and returns what renders it for one nonce. Refuses a build in which a
 * `<script>` or `<link rel=modulepreload>` does not carry the placeholder: served as it is, the
 * app would be a blank page under the strict CSP (security-headers.ts), so the API does not
 * start with it.
 */
export function shellTemplate(webDistDir: string): (nonce: string) => string {
  const html = readFileSync(join(webDistDir, 'index.html'), 'utf8');
  const parts = html.split(NONCE_ATTRIBUTE);
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  const preloads = (html.match(/<link\b[^>]*>/g) ?? []).filter((tag) =>
    /\brel=["']?modulepreload\b/.test(tag),
  );
  if (
    scripts.length === 0 ||
    [...scripts, ...preloads].some((tag) => !tag.includes(NONCE_ATTRIBUTE)) ||
    parts.some((part) => part.includes(CSP_NONCE_PLACEHOLDER))
  ) {
    throw new Error(
      `${webDistDir}/index.html was not built with html.cspNonce = ${CSP_NONCE_PLACEHOLDER}`,
    );
  }
  return (nonce) => parts.join(`nonce="${nonce}"`);
}

/**
 * The built web app, from the same origin as the API: the auth cookies are SameSite=strict and
 * scoped to /trpc. Runs after securityHeaders, whose nonce it puts into the shell.
 *
 * - The shell (`/`, `/index.html` and every client-side route such as /users): the cached
 *   index.html with this response's nonce, `no-store`. A stored copy would carry a nonce that no
 *   longer matches the policy of the response it is shown under, and a shared one would hand the
 *   nonce to whoever loaded it next.
 * - `/assets/*`: Vite's content-hashed files, cached for a year: a new build has new names.
 * - `/favicon.ico`: the icon, cached for a week. A build without it gets Nest's 404 there.
 * - The API paths stay with Nest, and any other file path (an old /assets/*.js after a deploy,
 *   a file at the root of dist) is Nest's 404, not the shell.
 */
export function serveWeb(app: NestExpressApplication, webDistDir: string): void {
  const render = shellTemplate(webDistDir);
  const hasFavicon = existsSync(join(webDistDir, FAVICON));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (hasFavicon && req.path === FAVICON && (req.method === 'GET' || req.method === 'HEAD')) {
      return res.sendFile(FAVICON, { root: webDistDir, maxAge: FAVICON_MAX_AGE });
    }
    const isApi = API_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`));
    const isFile = /\.[a-z0-9]+$/i.test(req.path) && req.path !== '/index.html';
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isApi || isFile) return next();
    const nonce = (res.locals as Partial<CspLocals>).cspNonce;
    // Only if securityHeaders did not run first: no page rather than one without its policy.
    if (!nonce) return next(new Error('the SPA shell is served without a CSP nonce'));
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(render(nonce));
  });
  // Only dist/assets is served as files, and only under /assets/. Nothing else at the root of dist
  // is (the favicon above is one exact path): a static server over the root would hand out the
  // raw index.html (its placeholder unreplaced, so a blank page) to any other spelling of it,
  // `//index.html` or `/%69ndex.html`.
  app.useStaticAssets(join(webDistDir, 'assets'), {
    prefix: '/assets',
    index: false,
    redirect: false,
    setHeaders: (res: ServerResponse) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
}
