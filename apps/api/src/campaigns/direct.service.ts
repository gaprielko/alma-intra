import {
  type DirectRecipient,
  type EmailNode,
  MAX_MESSAGE_BYTES,
  type SaveDirectInput,
} from '@intra/shared/schemas';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Db } from '../db/db.module.js';
import { fileUnder } from '../customers/customers.service.js';
import {
  campaignAttachments,
  campaignMessages,
  campaigns,
  emailTemplates,
  fileVersions,
  files,
  messageAttachments,
} from '../db/schema/index.js';
import { plainOf, renderEmail } from '../email/render.js';
import { getLook, valuesFor } from '../email/templates.service.js';
import {
  CampaignError,
  draft,
  liveFiles,
  versionsOf,
  writeCommonAttachments,
} from './campaigns.service.js';

/**
 * „Nový e-mail“ (docs/new-email.md): one e-mail as in any mailbox, to its To, Cc and Bcc, sent once.
 * Correspondence, not marketing: no unsubscribe link, and it goes even to the unsubscribed (D-14).
 * It lives as a campaign of the kind `direct`, so it shows in „Koncepty“, „Odoslané“ and on the
 * timeline; each recipient has a message row, the first one carries the sending.
 */

const paragraph = (text?: string): EmailNode => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
});
const subjectDoc = (text: string): EmailNode => ({ type: 'doc', content: [paragraph(text)] });

export async function createDirect(db: Db, userId: string) {
  const [row] = await db
    .insert(campaigns)
    .values({
      kind: 'direct',
      senderUserId: userId,
      subject: subjectDoc(''),
      body: { type: 'doc', content: [paragraph()] },
    })
    .returning({ id: campaigns.id });
  return { id: row!.id };
}

export async function getDirect(db: Db, id: string) {
  const row = await draft(db, id);
  if (row.kind !== 'direct') throw new CampaignError('NOT_FOUND');
  const attachments = await db
    .select({ id: files.id, name: files.name, size: fileVersions.size })
    .from(campaignAttachments)
    .innerJoin(files, eq(files.id, campaignAttachments.fileId))
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(eq(campaignAttachments.campaignId, id))
    .orderBy(asc(campaignAttachments.position));
  return {
    id: row.id,
    subject: row.subject ? plainOf(row.subject, {}, {}) : '',
    body: row.body ?? { type: 'doc', content: [paragraph()] },
    recipients: row.directRecipients,
    templateId: row.templateId,
    attachments,
  };
}

export async function saveDirect(db: Db, input: SaveDirectInput) {
  await db.transaction(async (tx) => {
    const row = await draft(tx, input.id, true);
    if (row.kind !== 'direct') throw new CampaignError('NOT_FOUND');
    await liveFiles(tx, input.attachmentFileIds);
    await tx
      .update(campaigns)
      .set({
        subject: subjectDoc(input.subject),
        subjectText: input.subject,
        body: input.body,
        directRecipients: input.recipients,
        templateId: input.templateId,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, input.id));
    await writeCommonAttachments(tx, input.id, input.attachmentFileIds);
  });
}

/** A document with its variables written out, so the rest of it is plain text to type over. */
function filled(
  node: EmailNode,
  values: Readonly<Record<string, string | undefined>>,
  labels: Record<string, string>,
): EmailNode {
  if (node.type === 'variable') {
    const name = typeof node.attrs?.name === 'string' ? node.attrs.name : '';
    const text = values[name] ?? `[${labels[name] ?? name}]`;
    return { type: 'text', text };
  }
  if (!node.content) return node;
  return { ...node, content: node.content.map((child) => filled(child, values, labels)) };
}

/**
 * A template for this e-mail: its subject and text with the variables replaced for the first
 * recipient; one without a value stays in brackets, to be written over. There is one text for all.
 */
export async function directFromTemplate(
  db: Db,
  input: { templateId: string; contactId: string | null; organizationId: string | null },
  userId: string,
) {
  const [template] = await db
    .select({
      subject: emailTemplates.subject,
      body: emailTemplates.body,
      customFields: emailTemplates.customFields,
    })
    .from(emailTemplates)
    .where(eq(emailTemplates.id, input.templateId));
  if (!template) throw new CampaignError('TEMPLATE_NOT_FOUND');
  const { values } = await valuesFor(
    db,
    { contactId: input.contactId ?? undefined, customerId: input.organizationId ?? undefined },
    userId,
    {},
  );
  const labels = Object.fromEntries(template.customFields.map((f) => [`custom.${f.key}`, f.label]));
  return {
    subject: plainOf(template.subject, values, labels),
    body: filled(template.body, values, labels),
  };
}

const ROLE_ORDER: Record<DirectRecipient['role'], number> = { to: 0, cc: 1, bcc: 2 };

/** Queues the e-mail: one send, carried by its first To; the others follow its outcome. */
export async function sendDirect(db: Db, env: Env, id: string) {
  const row = await draft(db, id);
  if (row.kind !== 'direct') throw new CampaignError('NOT_FOUND');
  const recipients = [...row.directRecipients].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
  );
  if (!recipients.some((r) => r.role === 'to')) throw new CampaignError('NO_RECIPIENTS');
  const body = row.body;
  if (!body || !row.subject || !JSON.stringify(body).includes('"text"')) {
    throw new CampaignError('NO_CONTENT');
  }
  const first = recipients[0]!;
  const { values, customerName } = await valuesFor(
    db,
    { contactId: first.contactId ?? undefined, customerId: first.organizationId ?? undefined },
    row.senderUserId,
    {},
  );
  const rendered = await renderEmail({
    look: await getLook(db),
    baseUrl: env.WEB_URL,
    subject: row.subject,
    body,
    values,
    labels: {},
    signature: true,
    customerName,
  });

  const attached = await db
    .select({ fileId: campaignAttachments.fileId })
    .from(campaignAttachments)
    .where(eq(campaignAttachments.campaignId, id))
    .orderBy(asc(campaignAttachments.position));
  return db.transaction(async (tx) => {
    await draft(tx, id, true);
    const versions = await versionsOf(
      tx,
      attached.map((a) => a.fileId),
    );
    const totalBytes =
      Buffer.byteLength(rendered.html) +
      versions.reduce((sum, v) => sum + Math.ceil((v.size * 4) / 3), 0);
    if (totalBytes > MAX_MESSAGE_BYTES) throw new CampaignError('TOO_LARGE');
    const now = new Date();
    const inserted = await tx
      .insert(campaignMessages)
      .values(
        await Promise.all(
          recipients.map(async (recipient, position) => ({
            campaignId: id,
            organizationId: recipient.organizationId
              ? await fileUnder(
                  tx,
                  recipient.organizationId,
                  recipient.contactId ? [recipient.contactId] : [],
                )
              : null,
            contactId: recipient.contactId,
            position,
            recipientRole: recipient.role,
            status: 'queued' as const,
            toEmail: recipient.email,
            toName: recipient.name,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            totalBytes,
            queuedAt: now,
            // Only the first is ever picked up; the rest wait for its outcome.
            nextAttemptAt: position === 0 ? now : null,
          })),
        ),
      )
      .returning({ id: campaignMessages.id, position: campaignMessages.position });
    const carrier = inserted.find((m) => m.position === 0)!;
    if (versions.length > 0) {
      await tx.insert(messageAttachments).values(
        versions.map((v, position) => ({
          messageId: carrier.id,
          fileVersionId: v.versionId,
          position,
          asLink: false,
        })),
      );
    }
    await tx
      .update(campaigns)
      .set({ status: 'sending', sentAt: now, subjectText: rendered.subject, updatedAt: now })
      .where(eq(campaigns.id, id));
    return { queued: inserted.length };
  });
}

/** The other recipients of a direct e-mail, for its one send. */
export async function directAddresses(db: Db, campaignId: string) {
  const rows = await db
    .select({
      email: campaignMessages.toEmail,
      role: campaignMessages.recipientRole,
      position: campaignMessages.position,
    })
    .from(campaignMessages)
    .where(inArray(campaignMessages.campaignId, [campaignId]))
    .orderBy(asc(campaignMessages.position));
  const of = (role: string) =>
    rows.filter((r) => r.role === role && r.position > 0 && r.email).map((r) => r.email!);
  return { alsoTo: of('to'), cc: of('cc'), bcc: of('bcc') };
}
