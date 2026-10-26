import { Global, Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadEnv } from '../config/env.js';
import * as schema from './schema/index.js';

export const DB = Symbol('DB');
export type Db = ReturnType<typeof createDb>;
/** A transaction of `Db`: what a function that runs inside one is given. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return drizzle(pool, { schema });
}

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => createDb(loadEnv().DATABASE_URL) }],
  exports: [DB],
})
export class DbModule {}
