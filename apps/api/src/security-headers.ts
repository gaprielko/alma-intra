import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

/** Where the middleware leaves the response's nonce for the SPA shell (spa-shell.ts). */
export type CspLocals = { cspNonce: string };

/** 128 bits from the CSPRNG, base64: fresh for every response, never reused, never logged. */
export const newCspNonce = (): string => randomBytes(16).toString('base64');

/*
 * A strict CSP, no host allowlist: a script runs only if it carries this response's nonce (the SPA
 * shell's `<script>` and `<link rel=modulepreload>` tags get it in spa-shell.ts) or was added by a
 * script that already runs ('strict-dynamic': Vite's lazy route chunks). A parser-inserted
 * `<script src>` without the nonce never runs, whatever its host.
 *
 * `'unsafe-inline' https:` are the fallbacks from Google's strict-CSP guide for browsers from
 * before CSP 2/3: a browser that knows nonces ignores 'unsafe-inline', and one that knows
 * 'strict-dynamic' ignores `https:`.
 *
 * The nonce is per response and must stay so: a nonce that is cached, shared or predictable is a
 * nonce an injected script can carry. So the shell is `no-store`. style-src keeps helmet's
 * 'unsafe-inline' for Radix's and React's style attributes and gets no nonce: a nonce there would
 * switch 'unsafe-inline' off. `base-uri 'none'`: the page has no `<base>`, and an injected one
 * could otherwise re-point relative script URLs.
 */
export function securityHeaders(storageOrigin: string[] = []) {
  const app = helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': [
          (_req, res) => `'nonce-${(res as Response<unknown, CspLocals>).locals.cspNonce}'`,
          "'strict-dynamic'",
          "'unsafe-inline'",
          'https:',
        ],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        // storageOrigin: the browser uploads files straight to object storage via signed URLs.
        'connect-src': ["'self'", ...storageOrigin],
        // https: the pictures of a document in the file preview. Its frame, an e-mail's too, narrows
        // this further with its own policy (apps/web/src/lib/safe-html.ts).
        'img-src': ["'self'", 'data:', 'blob:', 'https:', ...storageOrigin],
        // blob: a PDF shown in the file preview, always typed as a PDF so it cannot run as a page.
        'frame-src': ["'self'", 'blob:'],
      },
    },
    // The origin only, never the path: no customer id in a URL leaves the page.
    referrerPolicy: { policy: 'strict-origin' },
  });
  return (req: Request, res: Response, next: NextFunction) => {
    (res.locals as CspLocals).cspNonce = newCspNonce();
    return app(req, res, next);
  };
}
