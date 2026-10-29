import {
  Controller,
  Global,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  type OnApplicationShutdown,
  type OnModuleInit,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AuditTrail, writeAuditEvent } from '../audit/audit.js';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { describeError } from '../logging/describe-error.js';
import { transportFor } from '../mail/mailer.js';
import type { MailTransport } from '../mail/transport.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import { type InboundSource, inboundSource } from '../inbound/inbound.js';
import { takeInReceived } from '../inbound/intake.js';
import {
  dropForUnsubscribed,
  drainCampaigns,
  handleResendEvent,
  setUnsubscribed,
  verifyWebhook,
} from './delivery.js';
import { DownloadController } from './download.controller.js';

export const CAMPAIGN_TRANSPORT = Symbol('CAMPAIGN_TRANSPORT');
/** Where received e-mails are fetched; null without a Resend key (dev, tests). */
export const INBOUND_SOURCE = Symbol('INBOUND_SOURCE');
const POLL_INTERVAL_MS = 5_000;

/** Sends the queued e-mails to organizations inside the API process. Tests drain by hand. */
@Injectable()
export class CampaignWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('campaign-sender');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();
  private readonly stop = new AbortController();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CAMPAIGN_TRANSPORT) private readonly transport: MailTransport,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  onModuleInit() {
    if (loadEnv().NODE_ENV === 'test') return;
    const env = loadEnv();
    let busy = false;
    this.timer = setInterval(() => {
      if (busy) return;
      busy = true;
      this.running = drainCampaigns(this.db, this.transport, this.storage, env, this.stop.signal)
        .catch((error: unknown) =>
          this.logger.error({ msg: 'campaign drain failed', ...describeError(error) }),
        )
        .finally(() => (busy = false));
    }, POLL_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    this.stop.abort();
    await this.running;
  }
}

/**
 * Resend's delivery reports and received e-mails (`POST /webhooks/resend`), signed and verified,
 * and the one-click
 * unsubscribe of the `List-Unsubscribe-Post` header (`POST /u/<token>`). Both are public: the
 * signature and the token are the authentication.
 */
@Controller()
export class CampaignWebhookController {
  private readonly logger = new Logger('resend-webhook');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(INBOUND_SOURCE) private readonly inbound: InboundSource | null,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  @Post('webhooks/resend')
  @HttpCode(200)
  async resend(@Req() req: RawBodyRequest<Request>) {
    const secret = loadEnv().RESEND_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException();
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const id = header('svix-id');
    const ok =
      req.rawBody !== undefined &&
      verifyWebhook(
        secret,
        { id, timestamp: header('svix-timestamp'), signature: header('svix-signature') },
        req.rawBody,
      );
    if (!ok || !id) throw new UnauthorizedException();
    const event = req.body as Parameters<typeof handleResendEvent>[2];
    try {
      if (event.type === 'email.received') await this.received(event.data?.email_id);
      else await handleResendEvent(this.db, id, event);
    } catch (error) {
      this.logger.error({ msg: 'webhook event not handled', ...describeError(error) });
      throw error;
    }
    return { ok: true };
  }

  /**
   * A received e-mail, taken in by its id. Without a key nothing can be fetched; the 503 makes
   * Resend keep it and try again later.
   */
  private async received(providerEmailId: string | undefined) {
    if (!providerEmailId) return;
    if (!this.inbound) throw new ServiceUnavailableException();
    await takeInReceived(this.db, this.storage, this.inbound, providerEmailId, this.logger);
  }

  @Post('u/:token')
  @HttpCode(200)
  async oneClick(@Param('token') token: string, @Req() req: Request) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new NotFoundException();
    const changed = await setUnsubscribed(this.db, token, true);
    if (!changed) throw new NotFoundException();
    await dropForUnsubscribed(this.db, changed);
    const trail = new AuditTrail();
    trail.set({
      entityType: 'customer',
      entityId: changed.customerId,
      diff: {
        contact: 'unsubscribed',
        ...(changed.contactId ? { contactId: changed.contactId } : {}),
      },
    });
    await writeAuditEvent({
      db: this.db,
      req,
      requestId: String((req as { id?: unknown }).id),
      path: 'unsubscribe.oneClick',
      kind: 'mutation',
      input: null,
      result: null,
      trail,
      sessionUserId: null,
    });
    return { ok: true };
  }
}

@Global()
@Module({
  providers: [
    { provide: CAMPAIGN_TRANSPORT, useFactory: () => transportFor(loadEnv()) },
    { provide: INBOUND_SOURCE, useFactory: () => inboundSource(loadEnv()) },
    CampaignWorker,
  ],
  controllers: [CampaignWebhookController, DownloadController],
  exports: [CAMPAIGN_TRANSPORT],
})
export class CampaignsModule {}
