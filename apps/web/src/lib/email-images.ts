import { MAX_EMAIL_IMAGE_BYTES } from '@intra/shared/schemas';
import { trpcClient } from '@/lib/trpc';

/** E-mails are 600 px wide; twice that keeps an image sharp on a dense screen. */
const MAX_EDGE = 1200;

export class ImageNotAllowed extends Error {}

/**
 * Draws the picture anew at most 1200 px wide. Drawing drops whatever the file carried besides
 * pixels (EXIF, a camera's location). A PNG stays a PNG (it may be transparent, a logo); anything
 * else becomes a JPEG.
 */
async function resize(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new ImageNotAllowed();
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, 0.86),
  );
  if (blob.size > MAX_EMAIL_IMAGE_BYTES) throw new ImageNotAllowed();
  return { blob, width, height };
}

/** Resizes, uploads straight to the bucket and answers the image's key for `/m/<key>`. */
export async function uploadEmailImage(file: File): Promise<{ key: string; width: number }> {
  const { blob, width, height } = await resize(file);
  const mime = blob.type as 'image/png' | 'image/jpeg';
  const request = await trpcClient.template.requestImage.mutate({
    mime,
    size: blob.size,
    width,
    height,
  });
  const put = await fetch(request.url, {
    method: 'PUT',
    headers: { 'content-type': request.contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`PUT ${put.status}`);
  const { key } = await trpcClient.template.confirmImage.mutate({ id: request.id });
  return { key, width };
}
