import type { Request, Response } from 'express';
import type { RefreshedTokens } from './auth.service.js';

export const ACCESS_COOKIE = 'intra_at';
export const REFRESH_COOKIE = 'intra_rt';
/** „Zapamätať toto zariadenie“ at the second step: a browser that may skip it. */
export const TRUSTED_DEVICE_COOKIE = 'intra_td';

// Strict: the SPA and the API share a site, and no flow needs the cookies on a cross-site request.
const base = { httpOnly: true, sameSite: 'strict', path: '/trpc' } as const;
const secure = () => process.env.NODE_ENV === 'production';

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      // A malformed value is no cookie at all, not a 500.
      return undefined;
    }
  }
  return undefined;
}

/**
 * Session cookies, always: they disappear with the browser. No session is remembered: a session
 * that outlived its browser would outlive the idle timeout too. What „Zapamätať toto zariadenie“
 * remembers is the second step only (`setTrustedDeviceCookie`). Without a new refresh token (the
 * grace answer of `auth.refresh`) the refresh cookie is left alone: the request that won the
 * rotation sets it.
 */
export function setAuthCookies(res: Response, tokens: RefreshedTokens) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base, secure: secure() });
  if (tokens.refreshToken === null) return;
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, secure: secure() });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base, secure: secure() });
  res.clearCookie(REFRESH_COOKIE, { ...base, secure: secure() });
}

/**
 * The one cookie that outlives the browser: not a session, only the right to skip the second step
 * on this browser for 30 days. The session itself still ends with the browser and
 * with an hour of idleness; the password is asked every time. Revoked server-side, where only its
 * hash is kept.
 */
export function setTrustedDeviceCookie(res: Response, token: string, expires: Date) {
  res.cookie(TRUSTED_DEVICE_COOKIE, token, { ...base, secure: secure(), expires });
}
