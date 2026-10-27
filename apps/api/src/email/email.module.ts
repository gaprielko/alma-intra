import { Module } from '@nestjs/common';
import { ImageController } from './image.controller.js';

/** E-mail templates live in tRPC; this module serves the images of e-mails at `/m/<key>`. */
@Module({ controllers: [ImageController] })
export class EmailModule {}
