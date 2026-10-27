import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { DbModule } from './db/db.module.js';
import { EmailModule } from './email/email.module.js';
import { FilesModule } from './files/files.module.js';
import { HealthController } from './health/health.controller.js';
import { loggerOptions } from './logging/logger-options.js';
import { NoEchoExceptionFilter } from './logging/no-echo-exception.filter.js';
import { MailModule } from './mail/mail.module.js';
import { BreachCheckModule } from './security/breach-check.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TrpcModule } from './trpc/trpc.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: loggerOptions() }),
    DbModule,
    MailModule,
    BreachCheckModule,
    StorageModule,
    FilesModule,
    EmailModule,
    TrpcModule,
  ],
  controllers: [HealthController],
  // Outside tRPC an error is answered by its status, never by its message.
  providers: [{ provide: APP_FILTER, useClass: NoEchoExceptionFilter }],
})
export class AppModule {}
