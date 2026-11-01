import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { describeError } from '../logging/describe-error.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import { ShareFrameController } from '../sharing/share-frame.controller.js';
import { purgeFiles } from './files.service.js';

const PURGE_INTERVAL_MS = 3_600_000;

/**
 * Empties the trash of files older than 30 days and drops uploads that never arrived, once an
 * hour inside the API process. Tests purge by hand, so they get no timer.
 */
@Injectable()
export class FilePurgeWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('file-purge');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  onModuleInit() {
    if (loadEnv().NODE_ENV === 'test' || !this.storage) return;
    this.timer = setInterval(() => this.purge(), PURGE_INTERVAL_MS);
  }

  private purge() {
    const storage = this.storage!;
    this.running = purgeFiles(this.db, storage)
      .then((result) => {
        if (result.purgedFiles + result.purgedUploads > 0) this.logger.log(result);
      })
      .catch((error: unknown) =>
        this.logger.warn({ msg: 'file purge failed', ...describeError(error) }),
      );
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}

@Module({ providers: [FilePurgeWorker], controllers: [ShareFrameController] })
export class FilesModule {}
