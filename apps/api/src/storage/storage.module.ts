import { Global, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { loadEnv, storageEnvOf } from '../config/env.js';
import { describeError } from '../logging/describe-error.js';
import { createStorage, prepareLocalBucket } from './storage.js';

export const STORAGE = Symbol('STORAGE');

/**
 * One storage client for the API, handed to the tRPC context; `null` when no S3 variables are
 * set. Infrastructure only: the rules about files live in `files/`.
 */
@Global()
@Module({
  providers: [{ provide: STORAGE, useFactory: () => createStorage(loadEnv()) }],
  exports: [STORAGE],
})
export class StorageModule implements OnModuleInit {
  private readonly logger = new Logger('storage');

  async onModuleInit() {
    const env = loadEnv();
    const config = storageEnvOf(env);
    if (!config || env.NODE_ENV !== 'development') return;
    // A bucket that is not up yet must not stop the API: uploads fail until it is.
    try {
      await prepareLocalBucket(config, env.WEB_URL);
    } catch (error) {
      this.logger.warn({ msg: 'local bucket not prepared', ...describeError(error) });
    }
  }
}
