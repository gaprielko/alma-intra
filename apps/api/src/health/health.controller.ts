import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';

/**
 * REST on purpose: uptime checkers and Coolify health checks do not speak tRPC. `commit` tells the
 * staging E2E run when the build of its push is the one serving; `null` outside images.
 */
@Controller('health')
export class HealthController {
  private readonly commit = loadEnv().SOURCE_COMMIT ?? null;

  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok', commit: this.commit };
  }
}
