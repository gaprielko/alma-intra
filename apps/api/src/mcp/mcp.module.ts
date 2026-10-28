import { randomUUID } from 'node:crypto';
import { All, Controller, Inject, Logger, Module, Req, Res } from '@nestjs/common';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Request, Response } from 'express';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { describeError } from '../logging/describe-error.js';
import {
  type Hit,
  hit,
  ipSubject,
  RATE_LIMITS,
  type RateLimitRule,
} from '../security/rate-limit.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import { userOfAccessToken } from './access-tokens.js';
import { userOfOAuthToken } from './oauth.js';
import { buildMcpServer } from './server.js';

/**
 * `/mcp`: the Streamable HTTP endpoint Claude connects to (spec 7.5). Stateless: every request
 * carries its bearer token and gets a server of its own, bound to that token's user.
 */
@Controller()
export class McpController {
  private readonly logger = new Logger('mcp');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  @All('mcp')
  async handle(@Req() req: Request, @Res() res: Response) {
    const header = req.headers.authorization ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    // A personal token (Claude Code) or an OAuth access token (claude.ai, Desktop, Code).
    const user = token
      ? ((await userOfAccessToken(this.db, token)) ?? (await userOfOAuthToken(this.db, token)))
      : null;
    if (!user) {
      if (token) {
        const counted = await hit(this.db, RATE_LIMITS.mcpBadTokenPerIp, ipSubject(req.ip));
        if (counted.count > RATE_LIMITS.mcpBadTokenPerIp.limit) {
          this.tooMany(res, RATE_LIMITS.mcpBadTokenPerIp, counted);
          return;
        }
      }
      // Where a client learns how to get a token: Intra's OAuth (main.ts mounts it).
      const metadata = getOAuthProtectedResourceMetadataUrl(new URL(`${loadEnv().WEB_URL}/mcp`));
      res
        .status(401)
        .setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadata}"`)
        .json({ error: 'invalid_token' });
      return;
    }
    const counted = await hit(this.db, RATE_LIMITS.mcpPerUser, user.userId);
    if (counted.count > RATE_LIMITS.mcpPerUser.limit) {
      this.logger.warn({ msg: 'mcp rate limited', userId: user.userId });
      this.tooMany(res, RATE_LIMITS.mcpPerUser, counted);
      return;
    }
    const server = buildMcpServer({
      db: this.db,
      storage: this.storage,
      userId: user.userId,
      req,
      requestId:
        typeof (req as { id?: unknown }).id === 'string'
          ? (req as { id: string }).id
          : randomUUID(),
    });
    // No session id generator: stateless, one server per request.
    const transport = new StreamableHTTPServerTransport({});
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      // The SDK's own types disagree under `exactOptionalPropertyTypes`.
      await server.connect(transport as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error({ msg: 'mcp request failed', ...describeError(error) });
      if (!res.headersSent) res.status(500).json({ error: 'server_error' });
    }
  }

  /** 429 with when the window ends, so a client waits instead of hammering. */
  private tooMany(res: Response, rule: RateLimitRule, counted: Hit) {
    const retryAfter = Math.max(
      1,
      Math.ceil((counted.windowStart.getTime() + rule.windowMs - Date.now()) / 1000),
    );
    res.status(429).setHeader('Retry-After', String(retryAfter)).json({ error: 'rate_limited' });
  }
}

@Module({ controllers: [McpController] })
export class McpModule {}
