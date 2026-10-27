import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv, storageEnvOf } from './config/env.js';
import { securityHeaders } from './security-headers.js';
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

  // The image serves the built web app from the same origin as the API, its shell with the CSP
  // nonce of each response (spa-shell.ts). Unset in dev, where Vite serves it.
  if (env.WEB_DIST_DIR) serveWeb(app, env.WEB_DIST_DIR);

  await app.listen(env.API_PORT);
}

void bootstrap();
