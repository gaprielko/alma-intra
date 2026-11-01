import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { readCookie } from '../auth/cookies.js';
import type { Env } from '../config/env.js';

type Keyed = Pick<Env, 'DATA_ENCRYPTION_KEY'>;

/** A random 256 bits, base64url: a link's token, or the one that recognizes a browser. */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const signature = (env: Keyed, purpose: string, payload: string) =>
  createHmac('sha256', env.DATA_ENCRYPTION_KEY)
    .update(`${purpose}:${payload}`)
    .digest('base64url')
    .slice(0, 43);

function signed(env: Keyed, purpose: string, payload: string) {
  return `${payload}.${signature(env, purpose, payload)}`;
}

function verified(env: Keyed, purpose: string, value: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(env, purpose, payload));
  return given.length === expected.length && timingSafeEqual(given, expected) ? payload : null;
}

/** What a frame shows: a version of a file, or a draft. */
export type FrameTarget =
  | { kind: 'version'; id: string; mode: 'read' | 'comment' | 'edit' }
  | { kind: 'draft'; id: string; mode: 'draft' };

/** How long a frame's address opens: only for the page that asked for it to load it. */
const FRAME_SECONDS = 300;

/**
 * The token of `/share-frame/<token>`: signed, short-lived, and holding no link's token. It travels
 * in the path because a frame loads with a plain GET.
 */
export function frameToken(env: Keyed, target: FrameTarget, now = Date.now()) {
  const expires = Math.floor(now / 1000) + FRAME_SECONDS;
  return signed(
    env,
    'share-frame',
    [target.kind, target.id.replaceAll('-', ''), target.mode, expires.toString(36)].join('.'),
  );
}

export function readFrameToken(env: Keyed, token: string, now = Date.now()): FrameTarget | null {
  const payload = verified(env, 'share-frame', token);
  if (!payload) return null;
  const [kind, id, mode, expires] = payload.split('.') as [string, string, string, string];
  if (parseInt(expires, 36) * 1000 < now || !/^[0-9a-f]{32}$/.test(id)) return null;
  const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  if (kind === 'draft' && mode === 'draft') return { kind, id: uuid, mode };
  if (kind === 'version' && (mode === 'read' || mode === 'comment' || mode === 'edit')) {
    return { kind, id: uuid, mode };
  }
  return null;
}

export interface ShareSession {
  shareId: string;
  /** One visit: its comments belong to all drafts it saves. */
  sessionId: string;
  visitorId: string | null;
  generation: number;
}

const SESSION_MS = 12 * 60 * 60 * 1000;
const DEVICE_MS = 90 * 24 * 60 * 60 * 1000;

// As the rest of Intra: only for the API, and never on a cross-site request.
const base = { httpOnly: true, sameSite: 'strict', path: '/trpc' } as const;
const secure = () => process.env.NODE_ENV === 'production';
const sessionCookie = (shareId: string) => `intra_ss_${shareId.replaceAll('-', '')}`;
const deviceCookie = (fileId: string) => `intra_sv_${fileId.replaceAll('-', '')}`;

/** A session cookie: gone with the browser, and refused after 12 hours anyway. */
export function setShareSession(
  res: Response,
  env: Keyed,
  session: ShareSession,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({ ...session, expires: now + SESSION_MS }),
    'utf8',
  ).toString('base64url');
  res.cookie(sessionCookie(session.shareId), signed(env, 'share-session', payload), {
    ...base,
    secure: secure(),
  });
}

export function readShareSession(
  req: Request,
  env: Keyed,
  shareId: string,
  now = Date.now(),
): ShareSession | null {
  const value = readCookie(req, sessionCookie(shareId));
  const payload = value ? verified(env, 'share-session', value) : null;
  if (!payload) return null;
  try {
    const session = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as ShareSession & {
      expires: number;
    };
    return session.shareId === shareId && session.expires > now ? session : null;
  } catch {
    return null;
  }
}

/** Keeps the file's id, not the link's, so a new link still knows this browser. */
export function setDeviceCookie(res: Response, fileId: string, token: string, now = Date.now()) {
  res.cookie(deviceCookie(fileId), token, {
    ...base,
    secure: secure(),
    expires: new Date(now + DEVICE_MS),
  });
}

export const readDeviceCookie = (req: Request, fileId: string) =>
  readCookie(req, deviceCookie(fileId));

export function clearDeviceCookie(res: Response, fileId: string) {
  res.clearCookie(deviceCookie(fileId), { ...base, secure: secure() });
}
