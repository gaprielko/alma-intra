import { EMAIL_IMAGE_TYPES, MAX_EMAIL_IMAGE_BYTES } from '@intra/shared/schemas';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/db.module.js';
import { emailImages, files, fileVersions } from '../db/schema/index.js';
import type { Storage } from '../storage/storage.js';

export class ImageError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NOT_IMAGE' | 'STORAGE_NOT_CONFIGURED' | 'UPLOAD_MISMATCH',
  ) {
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

/** A PNG's size, from its header; `null` when the bytes are not a PNG. */
function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || !SIGNATURES['image/png']!(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), bytes };
}

/**
 * A JPEG's size, and the JPEG without its APP1 segments (EXIF, a camera's location): a picture
 * uploaded for an e-mail is drawn anew in the browser, this one comes straight from Files.
 */
function jpegSize(bytes: Uint8Array) {
  if (!SIGNATURES['image/jpeg']!(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let size: { width: number; height: number } | null = null;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    if (marker === 0xda) break; // Start of the picture's data: no more headers.
    const length = view.getUint16(at + 2) + 2;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame && at + 9 <= bytes.length) {
      size = { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    }
    if (marker !== 0xe1) kept.push(bytes.subarray(at, at + length));
    at += length;
  }
  if (!size) return null;
  kept.push(bytes.subarray(at));
  return { ...size, bytes: new Uint8Array(Buffer.concat(kept)) };
}

/**
 * A picture from the Files module as an image of e-mails (D-49): a copy, because an e-mail needs an
 * address that lasts and is open to anybody, while Files are private and change with new versions.
 */
export async function imageFromFile(
  db: Db,
  storage: Storage | null,
  userId: string,
  fileId: string,
) {
  const bucket = requireStorage(storage);
  const [file] = await db
    .select({
      storageKey: fileVersions.storageKey,
      mime: fileVersions.mime,
      size: fileVersions.size,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
  if (!file) throw new ImageError('NOT_FOUND');
  if (
    (file.mime !== 'image/png' && file.mime !== 'image/jpeg') ||
    file.size > MAX_EMAIL_IMAGE_BYTES
  ) {
    throw new ImageError('NOT_IMAGE');
  }
  const original = await bucket.read(file.storageKey);
  const image = file.mime === 'image/png' ? pngSize(original) : jpegSize(original);
  if (!image) throw new ImageError('NOT_IMAGE');
  const key = `${randomBytes(18).toString('base64url')}.${EMAIL_IMAGE_TYPES[file.mime]}`;
  const storageKey = `email-images/${key}`;
  await bucket.put(storageKey, image.bytes, file.mime);
  await db.insert(emailImages).values({
    key,
    storageKey,
    mime: file.mime,
    size: image.bytes.byteLength,
    width: image.width,
    height: image.height,
    createdByUserId: userId,
    confirmedAt: new Date(),
  });
  return { key, width: image.width, height: image.height };
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
