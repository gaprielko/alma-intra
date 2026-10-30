import type { NextFunction, Request, Response } from 'express';
import { securityHeaders } from './security-headers.js';

/** The headers the middleware sets for a GET of `path`. */
function headersFor(path: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    removeHeader: () => {},
    locals: {},
  } as unknown as Response;
  const req = { path, method: 'GET', headers: {} } as unknown as Request;
  let passed = false;
  securityHeaders()(req, res, (() => {
    passed = true;
  }) as NextFunction);
  expect(passed).toBe(true);
  return headers;
}

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

/** A source expression that names a host (or 'self'): what a strict script-src must not have. */
const HOST_SOURCE = /^'self'$|^(\w+:\/\/)?[\w*-]+(\.[\w*-]+)+(:\d+)?(\/.*)?$/;

describe('security headers', () => {
  it.each(['/', '/users', '/assets/index.js'])(
    'gives the app (%s) a strict script policy: a fresh nonce and strict-dynamic, no host',
    (path) => {
      const csp = headersFor(path)['content-security-policy']!;
      const sources = directive(csp, 'script-src')!.split(' ').slice(1);
      expect(sources).toEqual([
        expect.stringMatching(/^'nonce-[A-Za-z0-9+/]{22}=='$/),
        "'strict-dynamic'",
        "'unsafe-inline'",
        'https:',
      ]);
      expect(sources.filter((source) => HOST_SOURCE.test(source))).toEqual([]);
      expect(directive(csp, 'object-src')).toBe("object-src 'none'");
      expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
      expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
      expect(directive(csp, 'frame-src')).toBe("frame-src 'self' blob:");
      expect(csp).not.toMatch(/'unsafe-eval'/);
    },
  );

  it('never gives two responses the same nonce', () => {
    const nonces = new Set(
      Array.from(
        { length: 50 },
        () => /'nonce-([^']+)'/.exec(headersFor('/')['content-security-policy']!)?.[1],
      ),
    );
    expect(nonces.size).toBe(50);
  });

  it('sends only the origin as referrer', () => {
    expect(headersFor('/')['referrer-policy']).toBe('strict-origin');
  });
});
