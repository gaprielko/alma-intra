import { fileExtension, MAX_FILE_BYTES } from '@intra/shared/schemas';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { inboundMessages } from '../db/schema/index.js';
import { createFileFromBytes, customerRootFolderId, FileError } from '../files/files.service.js';
import type { Storage } from '../storage/storage.js';
import type { InboundSource } from './inbound.js';

const FETCH_TIMEOUT_MS = 30_000;

type Attachment = (typeof inboundMessages.$inferSelect)['attachments'][number];

/** Why an attachment cannot go into Files, judged by what the e-mail says of it. */
export function refusal(attachment: Pick<Attachment, 'filename' | 'size'>) {
  if (fileExtension(attachment.filename) === null) return 'type' as const;
  if (attachment.size > MAX_FILE_BYTES) return 'size' as const;
  return null;
}

/**
 * Saves the attachments of a received e-mail filed under a customer into the customer's folder
 * (spec 6.6), as files created from mail: the same types and size limit as an upload, and the
 * bytes must look like the extension says. Each one only once: the e-mail remembers the file
 * (`fileId`) or why it was left out (`skipped`). Nothing to do without a customer or a bucket.
 */
export async function saveInboundAttachments(
  db: Db,
  storage: Storage | null,
  source: InboundSource | null,
  inboundId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const [row] = await db
    .select({
      customerId: inboundMessages.customerId,
      providerEmailId: inboundMessages.providerEmailId,
      attachments: inboundMessages.attachments,
    })
    .from(inboundMessages)
    .where(eq(inboundMessages.id, inboundId));
  if (!row?.customerId || !storage || !source) return { saved: 0 };
  const waiting = row.attachments.filter((a) => !a.fileId && !a.skipped);
  if (waiting.length === 0) return { saved: 0 };

  const links = new Map(
    (await source.attachmentLinks(row.providerEmailId)).map((l) => [l.id, l.downloadUrl]),
  );
  const folderId = await customerRootFolderId(db, row.customerId);
  const done = new Map<string, Pick<Attachment, 'fileId' | 'skipped'>>();
  for (const attachment of waiting) {
    const refused = refusal(attachment);
    const url = links.get(attachment.id);
    if (refused || !url) {
      done.set(attachment.id, { skipped: refused ?? 'content' });
      continue;
    }
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`attachment download answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      const { fileId } = await createFileFromBytes(db, storage, {
        folderId,
        name: attachment.filename.slice(0, 200),
        bytes,
        userId: null,
        via: 'inbound',
      });
      done.set(attachment.id, { fileId });
    } catch (error) {
      if (!(error instanceof FileError)) throw error;
      done.set(attachment.id, {
        skipped: bytes.byteLength > MAX_FILE_BYTES ? 'size' : 'content',
      });
    }
  }
  // Read again: two deliveries of the webhook may have run side by side; the first answer wins.
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ attachments: inboundMessages.attachments })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, inboundId))
      .for('update');
    if (!current) return;
    await tx
      .update(inboundMessages)
      .set({
        attachments: current.attachments.map((a) =>
          a.fileId || a.skipped || !done.has(a.id) ? a : { ...a, ...done.get(a.id) },
        ),
      })
      .where(eq(inboundMessages.id, inboundId));
  });
  return { saved: [...done.values()].filter((d) => d.fileId).length };
}
