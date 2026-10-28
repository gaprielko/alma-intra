import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Response } from 'express';
import type { Env } from '../config/env.js';
import { decryptField, encryptField } from '../crypto/field-encryption.js';
import type { Db } from '../db/db.module.js';
import { oauthClients, oauthGrants, users } from '../db/schema/index.js';

/**
 * Intra as the OAuth 2.1 authorization server of its MCP endpoint (D-31), for claude.ai and
 * Claude Desktop (custom connector) and Claude Code: dynamic client registration, PKCE, the user
 * signs in to Intra and approves the client on „/oauth/consent“, then short-lived access tokens
 * and rotating refresh tokens. The SDK serves the endpoints; this keeps the state.
 */

const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 86_400_000;
const TOUCH_MS = 60_000;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;
const at = (clientId: string) => ({
  table: 'oauth_clients',
  column: 'secret_encrypted',
  rowId: clientId,
});

/** The tokens a client gets, written into the grant as hashes. */
function newTokens() {
  const access = secret('intra_oat_');
  const refresh = secret('intra_ort_');
  return {
    tokens: {
      access_token: access,
      token_type: 'bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
    } satisfies OAuthTokens,
    columns: {
      status: 'active' as const,
      accessHash: hash(access),
      accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
      refreshHash: hash(refresh),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  };
}

export function oauthProvider(db: Db, env: Pick<Env, 'WEB_URL' | 'DATA_ENCRYPTION_KEY'>) {
  const clientsStore: OAuthRegisteredClientsStore = {
    async getClient(clientId) {
      const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
      if (!row) return undefined;
      return {
        ...(row.info as OAuthClientInformationFull),
        client_id: row.clientId,
        ...(row.secretEncrypted
          ? {
              client_secret: decryptField(
                row.secretEncrypted,
                env.DATA_ENCRYPTION_KEY,
                at(row.clientId),
              ),
            }
          : {}),
      };
    },
    async registerClient(client) {
      const clientId = randomUUID();
      const { client_secret: clientSecret, ...info } = client;
      await db.insert(oauthClients).values({
        clientId,
        info: { ...info, client_id_issued_at: Math.floor(Date.now() / 1000) },
        secretEncrypted: clientSecret
          ? encryptField(clientSecret, env.DATA_ENCRYPTION_KEY, at(clientId))
          : null,
      });
      return {
        ...client,
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
    },
  };

  /** A grant of this client in the given state, by the hash of one of its secrets. */
  const grantBy = async (
    column: 'codeHash' | 'refreshHash' | 'accessHash',
    value: string,
    clientId: string,
  ) => {
    const [grant] = await db
      .select()
      .from(oauthGrants)
      .where(and(eq(oauthGrants[column], hash(value)), eq(oauthGrants.clientId, clientId)));
    return grant;
  };

  const provider: OAuthServerProvider = {
    get clientsStore() {
      return clientsStore;
    },

    /** The request waits for the user: the consent page signs them in and asks. */
    async authorize(
      client: OAuthClientInformationFull,
      params: AuthorizationParams,
      res: Response,
    ) {
      const [grant] = await db
        .insert(oauthGrants)
        .values({
          clientId: client.client_id,
          status: 'pending',
          request: {
            redirectUri: params.redirectUri,
            state: params.state,
            codeChallenge: params.codeChallenge,
            scopes: params.scopes ?? [],
            resource: params.resource?.href,
          },
          requestExpiresAt: new Date(Date.now() + REQUEST_TTL_MS),
        })
        .returning({ id: oauthGrants.id });
      res.redirect(`${env.WEB_URL}/oauth/consent?request=${grant!.id}`);
    },

    async challengeForAuthorizationCode(client, code) {
      const grant = await grantBy('codeHash', code, client.client_id);
      if (!grant || grant.status !== 'code') throw new InvalidGrantError('Unknown code');
      return grant.request.codeChallenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const grant = await grantBy('codeHash', code, client.client_id);
      if (
        !grant ||
        grant.status !== 'code' ||
        !grant.codeExpiresAt ||
        grant.codeExpiresAt.getTime() < Date.now() ||
        (redirectUri !== undefined && redirectUri !== grant.request.redirectUri)
      ) {
        throw new InvalidGrantError('The code is unknown, used or expired');
      }
      const { tokens, columns } = newTokens();
      // A code works once: only the update that still finds it waiting wins.
      const rows = await db
        .update(oauthGrants)
        .set({ ...columns, codeHash: null, codeExpiresAt: null })
        .where(and(eq(oauthGrants.id, grant.id), eq(oauthGrants.status, 'code')))
        .returning({ id: oauthGrants.id });
      if (rows.length === 0) throw new InvalidGrantError('The code is unknown, used or expired');
      return tokens;
    },

    /** A refresh token works once: each use hands out a new pair. */
    async exchangeRefreshToken(client, refreshToken) {
      const grant = await grantBy('refreshHash', refreshToken, client.client_id);
      if (
        !grant ||
        grant.status !== 'active' ||
        !grant.refreshExpiresAt ||
        grant.refreshExpiresAt.getTime() < Date.now()
      ) {
        throw new InvalidGrantError('The refresh token is unknown, used or expired');
      }
      const { tokens, columns } = newTokens();
      const rows = await db
        .update(oauthGrants)
        .set(columns)
        .where(and(eq(oauthGrants.id, grant.id), eq(oauthGrants.refreshHash, hash(refreshToken))))
        .returning({ id: oauthGrants.id });
      if (rows.length === 0) throw new InvalidGrantError('The refresh token was used already');
      return tokens;
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const found = await userOfOAuthToken(db, token);
      if (!found) throw new InvalidTokenError('Invalid or expired token');
      return {
        token,
        clientId: found.clientId,
        scopes: [],
        expiresAt: Math.floor(found.expiresAt.getTime() / 1000),
        extra: { userId: found.userId },
      };
    },

    async revokeToken(client, request: OAuthTokenRevocationRequest) {
      const value = hash(request.token);
      await db
        .update(oauthGrants)
        .set({ status: 'revoked', accessHash: null, refreshHash: null })
        .where(
          and(
            eq(oauthGrants.clientId, client.client_id),
            or(eq(oauthGrants.accessHash, value), eq(oauthGrants.refreshHash, value)),
          ),
        );
    },
  };
  return provider;
}

/** The user an OAuth access token stands for, while it is valid and the user active. */
export async function userOfOAuthToken(db: Db, token: string) {
  if (!token.startsWith('intra_oat_')) return null;
  const now = new Date();
  const [row] = await db
    .select({
      id: oauthGrants.id,
      userId: users.id,
      clientId: oauthGrants.clientId,
      expiresAt: oauthGrants.accessExpiresAt,
    })
    .from(oauthGrants)
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .where(
      and(
        eq(oauthGrants.accessHash, hash(token)),
        eq(oauthGrants.status, 'active'),
        gt(oauthGrants.accessExpiresAt, now),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
      ),
    );
  if (!row) return null;
  await db
    .update(oauthGrants)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(oauthGrants.id, row.id),
        or(
          isNull(oauthGrants.lastUsedAt),
          lt(oauthGrants.lastUsedAt, new Date(now.getTime() - TOUCH_MS)),
        ),
      ),
    );
  return { userId: row.userId, clientId: row.clientId, expiresAt: row.expiresAt! };
}

/** What the consent page shows: which client asks, where it goes back to, and whether it still can. */
export async function consentRequest(db: Db, id: string) {
  const [row] = await db
    .select({
      status: oauthGrants.status,
      expiresAt: oauthGrants.requestExpiresAt,
      redirectUri: oauthGrants.request,
      info: oauthClients.info,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
    .where(eq(oauthGrants.id, id));
  if (!row || row.status !== 'pending' || row.expiresAt.getTime() < Date.now()) return null;
  return {
    clientName:
      typeof row.info.client_name === 'string' && row.info.client_name.trim()
        ? row.info.client_name.trim().slice(0, 80)
        : null,
    redirectHost: new URL(row.redirectUri.redirectUri).host,
  };
}

/**
 * The user's answer: approved, the grant gets a one-time code for this user; refused, it ends.
 * Answers where the browser goes back to.
 */
export async function decideConsent(db: Db, userId: string, id: string, approve: boolean) {
  const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, id));
  if (!grant || grant.status !== 'pending' || grant.requestExpiresAt.getTime() < Date.now()) {
    return null;
  }
  const back = new URL(grant.request.redirectUri);
  if (grant.request.state) back.searchParams.set('state', grant.request.state);
  if (!approve) {
    await db.update(oauthGrants).set({ status: 'revoked' }).where(eq(oauthGrants.id, id));
    back.searchParams.set('error', 'access_denied');
    return { redirectTo: back.href, approved: false };
  }
  const code = secret('');
  const rows = await db
    .update(oauthGrants)
    .set({
      userId,
      status: 'code',
      codeHash: hash(code),
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    .where(and(eq(oauthGrants.id, id), eq(oauthGrants.status, 'pending')))
    .returning({ id: oauthGrants.id });
  if (rows.length === 0) return null;
  back.searchParams.set('code', code);
  return { redirectTo: back.href, approved: true };
}

/** One's own connected clients (claude.ai, Claude Desktop …), the live ones first. */
export async function listConnections(db: Db, userId: string) {
  const rows = await db
    .select({
      id: oauthGrants.id,
      info: oauthClients.info,
      createdAt: oauthGrants.createdAt,
      lastUsedAt: oauthGrants.lastUsedAt,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
    .where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.status, 'active')))
    .orderBy(desc(oauthGrants.createdAt))
    .limit(50);
  return rows.map(({ info, ...row }) => ({
    ...row,
    clientName: typeof info.client_name === 'string' ? info.client_name.slice(0, 80) : null,
  }));
}

/** Ends one of one's own connections: its tokens stop working at once. */
export async function revokeConnection(db: Db, userId: string, id: string) {
  const rows = await db
    .update(oauthGrants)
    .set({ status: 'revoked', accessHash: null, refreshHash: null })
    .where(and(eq(oauthGrants.id, id), eq(oauthGrants.userId, userId)))
    .returning({ id: oauthGrants.id });
  return rows.length > 0;
}
