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
import { remindDueNextSteps } from './activities.service.js';

const CHECK_INTERVAL_MS = 15 * 60_000;
/** Reminders wait for the working day: from 7:00 in Slovakia. */
const FROM_HOUR = 7;

/** The local date and hour in Slovakia, whatever the server's own time zone. */
export function localNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

/** Puts due next steps into their assignees' bells (spec 8), checked every 15 minutes. */
@Injectable()
export class NextStepReminder implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('next-step-reminder');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();

  constructor(@Inject(DB) private readonly db: Db) {}

  onModuleInit() {
    if (loadEnv().NODE_ENV === 'test') return;
    const check = () => {
      const now = localNow();
      if (now.hour < FROM_HOUR) return;
      this.running = remindDueNextSteps(this.db, now.date)
        .then((count) => {
          if (count > 0) this.logger.log({ msg: 'next steps reminded', count });
        })
        .catch((error: unknown) =>
          this.logger.error({ msg: 'next step reminder failed', ...describeError(error) }),
        );
    };
    this.timer = setInterval(check, CHECK_INTERVAL_MS);
    check();
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }
}

@Module({ providers: [NextStepReminder] })
export class ActivitiesModule {}
