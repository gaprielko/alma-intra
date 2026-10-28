import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { personalAccessTokens, users } from '../db/schema/index.js';

/** Recognisable in a leaked config or a secret scanner: `intra_pat_` and 43 random characters. */
const PREFIX = 'intra_pat_';
const DAY_MS = 86_400_000;
/** `lastUsedAt` is written at most this often: a busy Claude session is not a write per call. */
const TOUCH_MS = 60_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new token for the user; the plain value is returned once and never stored. */
export async function createAccessToken(
  db: Db,
  userId: string,
  input: { name: string; days: number },
) {
  const token = `${PREFIX}${randomBytes(32).toString('base64url')}`;
  const [row] = await db
    .insert(personalAccessTokens)
    .values({
      userId,
      name: input.name,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + input.days * DAY_MS),
    })
    .returning({ id: personalAccessTokens.id, expiresAt: personalAccessTokens.expiresAt });
  return { id: row!.id, token, expiresAt: row!.expiresAt };
}

/** One's own tokens that still work or ended lately, newest first; never the value. */
export async function listAccessTokens(db: Db, userId: string) {
  return db
    .select({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      createdAt: personalAccessTokens.createdAt,
      expiresAt: personalAccessTokens.expiresAt,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      revokedAt: personalAccessTokens.revokedAt,
    })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, userId))
    .orderBy(desc(personalAccessTokens.createdAt))
    .limit(50);
}

/** Revokes one of one's own tokens; another user's id is simply not found. */
export async function revokeAccessToken(db: Db, userId: string, id: string) {
  const rows = await db
    .update(personalAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(personalAccessTokens.id, id),
        eq(personalAccessTokens.userId, userId),
        isNull(personalAccessTokens.revokedAt),
      ),
    )
    .returning({ id: personalAccessTokens.id });
  return rows.length > 0;
}

/**
 * The user a bearer token stands for: a live, unexpired, unrevoked token of an active user, else
 * null. Notes when it was used.
 */
export async function userOfAccessToken(db: Db, token: string) {
  if (!token.startsWith(PREFIX)) return null;
  const now = new Date();
  const [row] = await db
    .select({
      id: personalAccessTokens.id,
      userId: users.id,
      lastUsedAt: personalAccessTokens.lastUsedAt,
    })
    .from(personalAccessTokens)
    .innerJoin(users, eq(users.id, personalAccessTokens.userId))
    .where(
      and(
        eq(personalAccessTokens.tokenHash, hash(token)),
        isNull(personalAccessTokens.revokedAt),
        gt(personalAccessTokens.expiresAt, now),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
      ),
    );
  if (!row) return null;
  await db
    .update(personalAccessTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(personalAccessTokens.id, row.id),
        or(
          isNull(personalAccessTokens.lastUsedAt),
          lt(personalAccessTokens.lastUsedAt, new Date(now.getTime() - TOUCH_MS)),
        ),
      ),
    );
  return { userId: row.userId, tokenId: row.id };
}
