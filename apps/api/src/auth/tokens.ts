import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'alma-api';
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Parses the `15m` / `30d` style durations used in the environment. */
export function durationMs(value: string): number {
  const match = /^(\d+)([mhd])$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}

export interface AccessClaims {
  userId: string;
  /** Refresh-token family the access token was issued from. */
  sessionId: string;
}

export async function signAccessToken(
  claims: AccessClaims,
  secret: string,
  ttl: string,
): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}

/** Returns `null` for anything that is not a valid, unexpired token of ours. */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: ISSUER,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Refresh tokens are high-entropy random values, so a plain SHA-256 is enough at rest. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
