import { EMAIL_IMAGE_TYPES } from '@intra/shared/schemas';
import { and, eq, isNotNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/db.module.js';
import { emailImages } from '../db/schema/index.js';
import type { Storage } from '../storage/storage.js';

export class ImageError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'STORAGE_NOT_CONFIGURED' | 'UPLOAD_MISMATCH') {
    super(code);
  }
}

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47].every((x, i) => b[i] === x),
  'image/jpeg': (b) => [0xff, 0xd8, 0xff].every((x, i) => b[i] === x),
  'image/webp': (b) =>
    [0x52, 0x49, 0x46, 0x46].every((x, i) => b[i] === x) &&
    [0x57, 0x45, 0x42, 0x50].every((x, i) => b[8 + i] === x),
};

function requireStorage(storage: Storage | null) {
  if (!storage) throw new ImageError('STORAGE_NOT_CONFIGURED');
  return storage;
}

/**
 * An image for e-mails: a random, unguessable key (`/m/<key>`), a pending row and a signed PUT.
 * The browser has already resized it and, by drawing it anew, dropped its EXIF data.
 */
export async function requestImage(
  db: Db,
  storage: Storage | null,
  userId: string,
  input: { mime: keyof typeof EMAIL_IMAGE_TYPES; size: number; width: number; height: number },
) {
  const bucket = requireStorage(storage);
  const key = `${randomBytes(18).toString('base64url')}.${EMAIL_IMAGE_TYPES[input.mime]}`;
  const storageKey = `email-images/${key}`;
  const [row] = await db
    .insert(emailImages)
    .values({ key, storageKey, ...input, createdByUserId: userId })
    .returning({ id: emailImages.id });
  const upload = await bucket.createUploadUrl(storageKey, {
    contentType: input.mime,
    contentLength: input.size,
  });
  return { id: row!.id, key, url: upload.url, contentType: input.mime };
}

/** The upload arrived as declared and looks like the image it claims to be. */
export async function confirmImage(db: Db, storage: Storage | null, id: string) {
  const [row] = await db.select().from(emailImages).where(eq(emailImages.id, id));
  if (!row) throw new ImageError('NOT_FOUND');
  const bucket = requireStorage(storage);
  if (row.confirmedAt) return { key: row.key };
  const object = await bucket.head(row.storageKey);
  const matches =
    object?.contentType === row.mime &&
    object.contentLength === row.size &&
    SIGNATURES[row.mime]!(await bucket.readPrefix(row.storageKey, 12));
  if (!matches) {
    await bucket.delete(row.storageKey);
    throw new ImageError('UPLOAD_MISMATCH');
  }
  await db.update(emailImages).set({ confirmedAt: new Date() }).where(eq(emailImages.id, id));
  return { key: row.key };
}

/** A fresh signed link to a confirmed image, for `/m/<key>`; `null` when there is none. */
export async function imageUrl(db: Db, storage: Storage | null, key: string) {
  if (!storage) return null;
  const [row] = await db
    .select({ storageKey: emailImages.storageKey, mime: emailImages.mime })
    .from(emailImages)
    .where(and(eq(emailImages.key, key), isNotNull(emailImages.confirmedAt)));
  if (!row) return null;
  const signed = await storage.createDownloadUrl(row.storageKey, {
    fileName: key,
    contentType: row.mime,
    inline: true,
  });
  return signed.url;
}
