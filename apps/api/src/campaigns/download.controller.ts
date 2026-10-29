import { sk } from '@intra/shared/i18n';
import { Controller, Get, Inject, Logger, Param, Res } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { loadEnv } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { files, fileVersions, messageAttachments } from '../db/schema/index.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import { readDownloadToken } from './download-link.js';

/**
 * `GET /d/<token>`: a file sent as a download link instead of an attachment (D-26), for anybody
 * with the link until it expires. Answers with a redirect to a fresh short-lived signed link, so
 * the object stays private. Only versions that left in an e-mail as a link open here.
 */
@Controller('d')
export class DownloadController {
  private readonly logger = new Logger(DownloadController.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response) {
    const read = readDownloadToken(loadEnv(), token);
    const refuse = (status: number, text: string) =>
      res.status(status).type('text/plain; charset=utf-8').send(text);
    if (read === 'expired') return refuse(410, sk.campaigns.download.expired);
    if (read === 'invalid' || !this.storage) return refuse(404, sk.campaigns.download.notFound);
    const [version] = await this.db
      .select({ key: fileVersions.storageKey, mime: fileVersions.mime, name: files.name })
      .from(fileVersions)
      .innerJoin(files, eq(files.id, fileVersions.fileId))
      .innerJoin(
        messageAttachments,
        and(
          eq(messageAttachments.fileVersionId, fileVersions.id),
          eq(messageAttachments.asLink, true),
        ),
      )
      .where(eq(fileVersions.id, read.fileVersionId))
      .limit(1);
    if (!version) return refuse(404, sk.campaigns.download.notFound);
    const signed = await this.storage.createDownloadUrl(version.key, {
      fileName: version.name,
      contentType: version.mime,
      inline: false,
    });
    this.logger.log({ msg: 'download link opened', fileVersionId: read.fileVersionId });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.redirect(302, signed.url);
  }
}
