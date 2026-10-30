import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AuditTrail, writeAuditEvent } from '../audit/audit.js';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import {
  feedbackConfirmationSchema,
  feedbackItemSchema,
  feedbackMessageSchema,
  receiveFeedback,
  receiveFeedbackEvent,
  verifyAlmaSignature,
} from './ados-feedback.js';

const BASE = 'api/integrations/ados';
/** A request with a picture is up to about 600 KB. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * The signature is over the exact bytes, and the app's JSON parser stops at 100 KB: these routes
 * read the raw body ahead of it, which then has nothing left to read. Called before the app starts.
 */
export function mountAdosBody(app: INestApplication) {
  app.use(`/${BASE}`, (req: Request & { _body?: boolean }, res: Response, next: NextFunction) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('error', next);
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) {
        res.sendStatus(413);
        return;
      }
      req.body = Buffer.concat(chunks);
      req._body = true;
      next();
    });
  });
}

/**
 * What Alma ADOS sends about its podnety (docs/activities-from-apps.md). Public: the signature is
 * the authentication. The texts may hold health data, so an error is logged by id and reason only.
 */
@Controller(BASE)
export class AdosFeedbackController {
  private readonly logger = new Logger('ados-feedback');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  /** The body once its signature holds. Unset secret: a 503, and Alma keeps it and tries again. */
  private verified<T>(req: Request, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
    const secret = loadEnv().ALMA_OUTBOUND_SECRET;
    if (!secret) throw new ServiceUnavailableException();
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const raw: unknown = req.body;
    const ok =
      Buffer.isBuffer(raw) &&
      verifyAlmaSignature(
        secret,
        { timestamp: header('x-alma-timestamp'), signature: header('x-alma-signature') },
        raw,
      );
    if (!ok) throw new UnauthorizedException();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpException('Unprocessable', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn({ msg: 'refused', paths: result.error.issues.map((i) => i.path.join('.')) });
      throw new HttpException('Unprocessable', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return result.data;
  }

  /** A database error quotes its values, which may be the texts: none of it reaches a log. */
  private async guarded<T>(what: string, id: string, fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error({ msg: `${what} not stored`, id });
      throw new InternalServerErrorException();
    }
  }

  @Post('feedback')
  @HttpCode(201)
  async feedback(@Req() req: Request) {
    const item = this.verified(req, feedbackItemSchema);
    const created = await this.guarded('feedback', item.id, () =>
      receiveFeedback(this.db, this.storage, item),
    );
    if (created) {
      const trail = new AuditTrail();
      trail.set({
        entityType: 'leadActivity',
        entityId: created.id,
        diff: {
          source: 'app',
          ...(created.productId ? { productId: created.productId } : {}),
          ...(created.organizationId ? { customerId: created.organizationId } : {}),
          ...(created.contactId ? { contactId: created.contactId } : {}),
        },
      });
      await writeAuditEvent({
        db: this.db,
        req,
        requestId: String((req as { id?: unknown }).id),
        path: 'adosFeedback.receive',
        kind: 'mutation',
        input: null,
        result: null,
        trail,
        sessionUserId: null,
      });
    }
    return { ok: true };
  }

  @Post('feedback/:id/messages')
  @HttpCode(201)
  async message(@Param('id') id: string, @Req() req: Request) {
    const event = this.verified(req, feedbackMessageSchema);
    if (event.feedbackId !== id) throw new NotFoundException();
    const known = await this.guarded('message', event.id, () =>
      receiveFeedbackEvent(this.db, id, { ...event, kind: 'message' }),
    );
    if (!known) throw new NotFoundException();
    return { ok: true };
  }

  @Post('feedback/:id/confirmation')
  @HttpCode(201)
  async confirmation(@Param('id') id: string, @Req() req: Request) {
    const event = this.verified(req, feedbackConfirmationSchema);
    if (event.feedbackId !== id) throw new NotFoundException();
    const known = await this.guarded('confirmation', event.id, () =>
      receiveFeedbackEvent(this.db, id, { ...event, kind: 'confirmation' }),
    );
    if (!known) throw new NotFoundException();
    return { ok: true };
  }
}

@Module({ controllers: [AdosFeedbackController] })
export class AdosModule {}
