import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IMAGE_KEY } from '@intra/shared/schemas';
import { DB, type Db } from '../db/db.module.js';
import { STORAGE } from '../storage/storage.module.js';
import type { Storage } from '../storage/storage.js';
import { imageUrl } from './images.service.js';

/**
 * `GET /m/<key>`: an image of an e-mail, for anybody who has the key (a recipient's mail client
 * has no session). Answers with a redirect to a fresh signed link, so the link in an e-mail never
 * expires while the object stays private. The key is random; nothing but e-mail images is here.
 */
@Controller('m')
export class ImageController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  @Get(':key')
  async image(@Param('key') key: string, @Res() res: Response) {
    if (!IMAGE_KEY.test(key)) throw new NotFoundException();
    const url = await imageUrl(this.db, this.storage, key);
    if (!url) throw new NotFoundException();
    // Shorter than the signed link's life: a cached redirect never points at an expired one.
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.redirect(302, url);
  }
}
