import { Controller, Get, Inject, Logger, Param, Res } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Response } from 'express';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { files, fileVersions } from '../db/schema/index.js';
import { describeError } from '../logging/describe-error.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import { draftFramePage } from './drafts.service.js';
import { framePage } from './share-html.js';
import { readFrameToken } from './share-tokens.js';

/**
 * Where a shared document runs. `sandbox` without `allow-same-origin` gives it an opaque origin even
 * when this address is opened on its own: no cookies, no API, no page around it, and `connect-src`
 * lets it fetch nothing. `script-src 'unsafe-inline'` is on purpose: the document's own scripts run
 * here and nowhere else. This replaces the policy of `securityHeaders` for these responses alone.
 */
export const FRAME_POLICY = [
  'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob: https:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

/** `GET /share-frame/<token>`: the token is signed, short-lived, and given only to a page allowed to show it. */
@Controller('share-frame')
export class ShareFrameController {
  private readonly logger = new Logger(ShareFrameController.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  @Get(':token')
  async frame(@Param('token') token: string, @Res() res: Response) {
    const target = readFrameToken(loadEnv(), token);
    res.setHeader('Content-Security-Policy', FRAME_POLICY);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    const notFound = () => res.status(404).type('text/plain; charset=utf-8').send('');
    if (!target || !this.storage) return notFound();
    try {
      const page =
        target.kind === 'draft'
          ? await draftFramePage(this.db, this.storage, target.id)
          : await this.versionPage(this.storage, target.id, target.mode);
      if (page === null) return notFound();
      res.status(200).type('text/html; charset=utf-8').send(page);
    } catch (error) {
      this.logger.warn({ msg: 'shared frame refused', ...describeError(error) });
      notFound();
    }
  }

  private async versionPage(
    storage: Storage,
    versionId: string,
    mode: 'read' | 'comment' | 'edit',
  ) {
    const [version] = await this.db
      .select({ key: fileVersions.storageKey, mime: fileVersions.mime })
      .from(fileVersions)
      .innerJoin(files, eq(files.id, fileVersions.fileId))
      .where(
        and(
          eq(fileVersions.id, versionId),
          eq(fileVersions.status, 'uploaded'),
          isNull(files.deletedAt),
        ),
      );
    if (version?.mime !== 'text/html') return null;
    return framePage(new TextDecoder().decode(await storage.read(version.key)), { mode });
  }
}
