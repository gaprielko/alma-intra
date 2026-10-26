import {
  Global,
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
import { drainMailOutbox, purgeMailOutbox } from './mail-outbox.js';
import { createMailer, type Mailer } from './mailer.js';

export const MAILER = Symbol('MAILER');
const POLL_INTERVAL_MS = 5_000;
const PURGE_INTERVAL_MS = 3_600_000;

/** Polls the outbox inside the API process. Tests drain by hand, so they get no timer. */
@Injectable()
export class MailOutboxWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('mail-outbox');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();
  private readonly stop = new AbortController();
  private lastPurge = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  onModuleInit() {
    if (loadEnv().NODE_ENV !== 'test') this.start();
  }

  start(intervalMs = POLL_INTERVAL_MS) {
    if (this.timer || this.stop.signal.aborted) return;
    let busy = false;
    this.timer = setInterval(() => {
      if (busy) return;
      busy = true;
      this.running = drainMailOutbox(this.db, this.mailer, this.stop.signal)
        .catch((error: unknown) =>
          this.logger.error({ msg: 'mail outbox poll failed', ...describeError(error) }),
        )
        .finally(() => (busy = false));
      this.purgeNowAndThen();
    }, intervalMs);
  }

  /** Housekeeping on the side: not awaited, and a failure only gets logged. */
  private purgeNowAndThen() {
    if (Date.now() - this.lastPurge < PURGE_INTERVAL_MS) return;
    this.lastPurge = Date.now();
    void purgeMailOutbox(this.db).catch((error: unknown) =>
      this.logger.warn({ msg: 'mail outbox purge failed', ...describeError(error) }),
    );
  }

  /**
   * Stops the timer, lets the delivery in flight finish (at most the send timeout) and claims
   * nothing more; what is still queued waits for the next start or another instance.
   */
  async onApplicationShutdown() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.stop.abort();
    await this.running;
  }
}

/** One mailer for the API: procedures queue, the worker sends. */
@Global()
@Module({
  providers: [{ provide: MAILER, useFactory: () => createMailer(loadEnv()) }, MailOutboxWorker],
  exports: [MAILER],
})
export class MailModule {}
