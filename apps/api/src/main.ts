import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv, storageEnvOf } from './config/env.js';
import { securityHeaders } from './security-headers.js';
import { DB, type Db } from './db/db.module.js';
import { oauthProvider } from './mcp/oauth.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { serveWeb } from './spa-shell.js';

async function bootstrap() {
  const env = loadEnv();
  // `rawBody`: the Resend webhook's signature is over the exact bytes it sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  // A nonce-based strict CSP and Referrer-Policy; what each allows and why is in security-headers.ts.
  // The browser uploads files straight to object storage via signed URLs.
  const storageOrigin = storageEnvOf(env) ? [new URL(env.S3_ENDPOINT!).origin] : [];
  app.use(securityHeaders(storageOrigin));
  // Production runs behind exactly one proxy (Coolify's Traefik). Without this every client shares
  // the proxy's IP, which breaks rate limiting and the audit trail.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  // SIGTERM on deploy: lets the mail outbox worker finish the delivery in flight.
  app.enableShutdownHooks();

  // Intra is the OAuth server of its MCP endpoint (D-31): metadata, client registration,
  // /authorize (on to the consent page), /token and /revoke, from the MCP SDK.
  app.use(
    mcpAuthRouter({
      provider: oauthProvider(app.get<Db>(DB), env),
      issuerUrl: new URL(env.WEB_URL),
      resourceServerUrl: new URL(`${env.WEB_URL}/mcp`),
      resourceName: 'Alma Intra',
    }),
  );

  // The image serves the built web app from the same origin as the API, its shell with the CSP
  // nonce of each response (spa-shell.ts). Unset in dev, where Vite serves it.
  if (env.WEB_DIST_DIR) serveWeb(app, env.WEB_DIST_DIR);

  await app.listen(env.API_PORT);
}

void bootstrap();
