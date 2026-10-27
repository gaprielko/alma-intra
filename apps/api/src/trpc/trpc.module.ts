import type { NextFunction, Request, Response } from 'express';
import { Inject, Logger, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { registerInputKeys } from '../audit/input-keys.js';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { describeError } from '../logging/describe-error.js';
import { BREACH_CHECK } from '../security/breach-check.module.js';
import type { BreachCheck } from '../security/breached-password.js';
import { CAMPAIGN_TRANSPORT } from '../campaigns/campaigns.module.js';
import type { MailTransport } from '../mail/transport.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import { appRouter } from './app.router.js';
import { createContextFactory } from './context.js';

// The audit interceptor names the fields that were sent; only names a schema declares.
registerInputKeys(appRouter);

/** Largest batch the web client produces on a page load is far below this. */
const MAX_BATCH_SIZE = 10;

/** Mounts the tRPC router as Nest middleware so it runs after the request logger. */
@Module({})
export class TrpcModule implements NestModule {
  private readonly logger = new Logger('trpc');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BREACH_CHECK) private readonly breachCheck: BreachCheck | null,
    @Inject(STORAGE) private readonly storage: Storage | null,
    @Inject(CAMPAIGN_TRANSPORT) private readonly campaignTransport: MailTransport,
  ) {}

  configure(consumer: MiddlewareConsumer) {
    const env = loadEnv();
    consumer
      .apply(
        // No answer of the API may be kept by a browser's HTTP cache: every answer tRPC writes,
        // errors and batches included, says `no-store`.
        (_req: Request, res: Response, next: NextFunction) => {
          res.setHeader('Cache-Control', 'no-store');
          next();
        },
        createExpressMiddleware({
          router: appRouter,
          // The client sends queries as POST, so that inputs never travel in a URL.
          allowMethodOverride: true,
          createContext: createContextFactory(
            this.db,
            env,
            this.breachCheck,
            this.storage,
            this.campaignTransport,
          ),
          maxBatchSize: MAX_BATCH_SIZE,
          onError: ({ error, path, ctx }) => {
            if (error.code !== 'INTERNAL_SERVER_ERROR') return;
            this.logger.error({ path, requestId: ctx?.requestId, ...describeError(error) });
          },
        }),
      )
      .forRoutes('trpc');
  }
}
