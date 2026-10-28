import { randomUUID } from 'node:crypto';
import { All, Controller, Inject, Logger, Module, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Request, Response } from 'express';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { describeError } from '../logging/describe-error.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import { userOfAccessToken } from './access-tokens.js';
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
    const user = token ? await userOfAccessToken(this.db, token) : null;
    if (!user) {
      // Where a client learns how to get a token (OAuth, E7c); a personal token works meanwhile.
      res
        .status(401)
        .setHeader(
          'WWW-Authenticate',
          `Bearer resource_metadata="${loadEnv().WEB_URL}/.well-known/oauth-protected-resource"`,
        )
        .json({ error: 'invalid_token' });
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
}

@Module({ controllers: [McpController] })
export class McpModule {}
