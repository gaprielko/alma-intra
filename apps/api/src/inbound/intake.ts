import type { Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import type { Db } from '../db/db.module.js';
import { inboundMessages, users } from '../db/schema/index.js';
import { describeError } from '../logging/describe-error.js';
import type { Storage } from '../storage/storage.js';
import { saveInboundAttachments } from './attachments.js';
import { type InboundSource, receiveInbound } from './inbound.js';

/**
 * Takes in one received e-mail: fetched from the provider (the webhook's event carries no body),
 * filed, a copy forwarded to the colleague it is for (D-27) and its attachments saved. Answers
 * whether it is new; one the provider no longer has answers `false`.
 */
export async function takeInReceived(
  db: Db,
  storage: Storage | null,
  source: InboundSource,
  providerEmailId: string,
  logger: Logger,
) {
  const email = await source.get(providerEmailId);
  if (!email) return false;
  const filed = await receiveInbound(db, loadEnv(), email);
  if (filed.repeated) return false;
  logger.log({ msg: 'e-mail received', inboundId: filed.id, matched: filed.matched });
  if (filed.id && filed.userId) {
    await forwardCopy(db, source, providerEmailId, filed.id, filed.userId).catch((error: unknown) =>
      logger.warn({
        msg: 'copy of a received e-mail not forwarded',
        inboundId: filed.id,
        ...describeError(error),
      }),
    );
  }
  // The e-mail is kept whatever happens to its attachments; a failure is retried on assigning.
  if (filed.id && filed.matched) {
    await saveInboundAttachments(db, storage, source, filed.id).catch((error: unknown) =>
      logger.warn({
        msg: 'attachments of a received e-mail not saved',
        inboundId: filed.id,
        ...describeError(error),
      }),
    );
  }
  return true;
}

async function forwardCopy(
  db: Db,
  source: InboundSource,
  providerEmailId: string,
  inboundId: string,
  userId: string,
) {
  const [user] = await db
    .select({ email: users.email, status: users.status })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.status !== 'active') return;
  await source.forward(
    providerEmailId,
    { to: user.email, from: `Alma Intra <${loadEnv().CAMPAIGN_FROM_ADDRESS}>` },
    `inbound-copy/${inboundId}`,
  );
}

/**
 * „Načítať nové“ in „Prijaté“: the provider's latest received e-mails that Intra does not have
 * yet, taken in as if the webhook had told of them. Catches up what a missed or failed webhook
 * call left behind. Answers how many came in.
 */
export async function syncInbound(
  db: Db,
  storage: Storage | null,
  source: InboundSource,
  logger: Logger,
) {
  const ids = await source.recent();
  if (ids.length === 0) return { added: 0 };
  const known = await db
    .select({ id: inboundMessages.providerEmailId })
    .from(inboundMessages)
    .where(inArray(inboundMessages.providerEmailId, ids));
  const have = new Set(known.map((row) => row.id));
  let added = 0;
  // Oldest first, so the list reads in the order the e-mails came.
  for (const id of ids.filter((id) => !have.has(id)).reverse()) {
    if (await takeInReceived(db, storage, source, id, logger)) added += 1;
  }
  return { added };
}
