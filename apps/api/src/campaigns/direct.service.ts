import { randomUUID } from 'node:crypto';
import { sk } from '@intra/shared/i18n';
import {
  type DirectRecipient,
  filledLookLines,
  lookValuesOf,
  type LookKind,
  type EmailNode,
  MAX_MESSAGE_BYTES,
  type AnswerMode,
  type SaveDirectInput,
} from '@intra/shared/schemas';
import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
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
  inboundMessages,
  messageAttachments,
  organizationProducts,
  emailLooks,
  users,
} from '../db/schema/index.js';
import { plainOf, renderEmail } from '../email/render.js';
import { lookFor, valuesFor } from '../email/templates.service.js';
import { htmlToText } from '../inbound/forwarded.js';
import { companyAddresses } from '../inbound/import.js';
import { bySender } from '../inbound/inbound.js';
import { activityUrl, type RecordedActivity } from './interest-link.js';
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

const r = sk.inbound.replyDraft;

const lineNodes = (text: string): EmailNode[] =>
  text
    .split('\n')
    .flatMap((line, i) => [
      ...(i > 0 ? [{ type: 'hardBreak' } as EmailNode] : []),
      ...(line ? [{ type: 'text', text: line } as EmailNode] : []),
    ]);

/** A date as the app writes it, in Bratislava time: `30.10.2026 9:12`. */
const whenOf = (date: Date) =>
  new Intl.DateTimeFormat('sk-SK', {
    timeZone: 'Europe/Bratislava',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(date)
    .replace(/\.\s+/g, '.')
    .replace(/,/g, '');

/** What a received e-mail says, for quoting: its own head line and its plain text. */
function quoteOf(
  received: Pick<
    typeof inboundMessages.$inferSelect,
    'fromEmail' | 'fromName' | 'receivedAt' | 'text' | 'html'
  >,
  mode: AnswerMode,
) {
  const who = received.fromName
    ? `${received.fromName} <${received.fromEmail}>`
    : received.fromEmail;
  const at = whenOf(received.receivedAt);
  const text = (received.text?.trim() ? received.text : htmlToText(received.html ?? ''))
    .trim()
    .slice(0, 50_000);
  return { head: mode === 'forward' ? r.quoteForward(who, at) : r.quoteReply(who, at), text };
}

/** The quote under an answer or a forward, in the blocks an e-mail body may have. */
const quoteNodes = (quote: { head: string; text: string }): EmailNode[] => [
  { type: 'horizontalRule' },
  {
    type: 'paragraph',
    content: [{ type: 'text', text: quote.head, marks: [{ type: 'bold' }] }],
  },
  ...quote.text
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block): EmailNode => ({ type: 'paragraph', content: lineNodes(block) })),
];

/**
 * The sender's signature as text of the body, so that it can be changed in this one e-mail. It has
 * the same lines as the signature under other e-mails of that look.
 */
async function signatureNodes(db: Db, userId: string, kind: LookKind, productId: string | null) {
  const [{ values }, look] = await Promise.all([
    valuesFor(db, {}, userId, {}),
    lookFor(db, kind, productId),
  ]);
  return filledLookLines(
    look.signatureDoc,
    lookValuesOf(look, values),
    sk.templates.footer.unsubscribe,
  );
}

/** The product of an organization that has just one and a look of its own: else the global look. */
async function lookProductOf(db: Db, organizationId: string | null) {
  if (!organizationId) return null;
  const held = await db
    .select({ productId: organizationProducts.productId, own: emailLooks.enabled })
    .from(organizationProducts)
    .leftJoin(
      emailLooks,
      and(
        eq(emailLooks.productId, organizationProducts.productId),
        eq(emailLooks.kind, 'personal'),
      ),
    )
    .where(eq(organizationProducts.organizationId, organizationId))
    .limit(2);
  return held.length === 1 && held[0]!.own ? held[0]!.productId : null;
}

/** Who „Odpovedať všetkým“ also writes to: the e-mail's others, without Alma's own addresses. */
async function othersOf(
  db: Db,
  env: Pick<Env, 'INBOUND_REPLY_DOMAIN'>,
  received: Pick<typeof inboundMessages.$inferSelect, 'fromEmail' | 'toEmails' | 'ccEmails'>,
  userId: string,
) {
  const [me] = await db
    .select({ email: users.email, addresses: users.importAddresses })
    .from(users)
    .where(eq(users.id, userId));
  const ours = new Set([
    ...(await companyAddresses(db)),
    received.fromEmail,
    ...(me ? [me.email.toLowerCase(), ...me.addresses] : []),
  ]);
  const domain = env.INBOUND_REPLY_DOMAIN?.toLowerCase();
  const people: DirectRecipient[] = [];
  const add = async (email: string, role: DirectRecipient['role']) => {
    if (ours.has(email) || (domain && email.endsWith(`@${domain}`))) return;
    ours.add(email);
    const known = await bySender(db, email);
    people.push({
      role,
      email,
      name: null,
      contactId: known?.contactId ?? null,
      organizationId: known?.customerId ?? null,
    });
  };
  for (const email of received.toEmails) await add(email, 'to');
  for (const email of received.ccEmails) await add(email, 'cc');
  return people;
}

const subjectOf = (subject: string, mode: AnswerMode) => {
  if (mode === 'forward') return /^(fwd?|fw):/i.test(subject) ? subject : `Fwd: ${subject}`;
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
};

/**
 * „Odpovedať“, „Odpovedať všetkým“ or „Preposlať“ (docs/conversation-reply.md): the user's draft of
 * that kind for a received e-mail, made when there is none. An answer needs the e-mail filed, as it
 * goes to a customer; a forward goes wherever the user says, with the attachments Files has of it.
 */
export async function replyDraft(
  db: Db,
  env: Pick<Env, 'INBOUND_REPLY_DOMAIN'>,
  userId: string,
  input: { inboundId: string; mode: AnswerMode },
) {
  const [received] = await db
    .select()
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, input.inboundId), ne(inboundMessages.status, 'discarded')));
  if (!received) throw new CampaignError('NOT_FOUND');
  const answer = input.mode !== 'forward';
  if (answer && (received.status !== 'assigned' || !received.organizationId)) {
    throw new CampaignError('NOT_FOUND');
  }
  const [existing] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.replyToInboundId, input.inboundId),
        eq(campaigns.replyMode, input.mode),
        eq(campaigns.senderUserId, userId),
        eq(campaigns.status, 'draft'),
      ),
    );
  if (existing) return { id: existing.id };

  const recipients: DirectRecipient[] = answer
    ? [
        {
          role: 'to',
          email: received.fromEmail,
          name: received.fromName,
          contactId: received.contactId,
          organizationId: received.organizationId,
        },
        ...(input.mode === 'replyAll' ? await othersOf(db, env, received, userId) : []),
      ]
    : [];
  const lookProductId = await lookProductOf(db, received.organizationId);
  const subject = subjectOf(received.subject, input.mode);
  const saved = received.attachments.flatMap((a) => (a.fileId ? [a.fileId] : []));
  const live =
    input.mode === 'forward' && saved.length > 0
      ? await db
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              inArray(files.id, saved),
              isNull(files.deletedAt),
              isNotNull(files.currentVersionId),
            ),
          )
      : [];
  const signature = await signatureNodes(db, userId, 'personal', lookProductId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(campaigns)
      .values({
        kind: 'direct',
        senderUserId: userId,
        replyToInboundId: input.inboundId,
        replyMode: input.mode,
        subject: subjectDoc(subject),
        subjectText: subject,
        body: { type: 'doc', content: [paragraph(), ...signature] },
        directRecipients: recipients,
        lookProductId,
      })
      .returning({ id: campaigns.id });
    await writeCommonAttachments(
      tx,
      row!.id,
      live.map((f) => f.id),
    );
    return { id: row!.id };
  });
}

/** The user's drafts written from a received e-mail, oldest first. */
export async function replyDrafts(db: Db, userId: string, inboundId: string) {
  return db
    .select({ id: campaigns.id, mode: campaigns.replyMode })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.replyToInboundId, inboundId),
        eq(campaigns.senderUserId, userId),
        eq(campaigns.status, 'draft'),
      ),
    )
    .orderBy(asc(campaigns.createdAt));
}

/** The e-mail a draft is written from: what is quoted, and what could not be forwarded with it. */
async function replyOf(
  db: Db,
  row: { replyToInboundId: string | null; replyMode: AnswerMode | null },
) {
  if (!row.replyToInboundId || !row.replyMode) return null;
  const [received] = await db
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, row.replyToInboundId));
  if (!received) return null;
  return {
    inboundId: received.id,
    mode: row.replyMode,
    quote: quoteOf(received, row.replyMode),
    /** Attachments Files does not have: nothing to send of those. */
    leftOut: row.replyMode === 'forward' ? received.attachments.filter((a) => !a.fileId).length : 0,
  };
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
    lookProductId: row.lookProductId,
    lookKind: row.lookKind,
    attachments,
    reply: await replyOf(db, row),
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
        lookProductId: input.lookProductId,
        lookKind: input.lookKind,
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
      lookProductId: emailTemplates.lookProductId,
      lookKind: emailTemplates.lookKind,
    })
    .from(emailTemplates)
    .where(eq(emailTemplates.id, input.templateId));
  if (!template) throw new CampaignError('TEMPLATE_NOT_FOUND');
  const { values: known } = await valuesFor(
    db,
    { contactId: input.contactId ?? undefined, customerId: input.organizationId ?? undefined },
    userId,
    {},
  );
  const labels = {
    ...(sk.templates.variables as unknown as Record<string, string>),
    ...Object.fromEntries(template.customFields.map((f) => [`custom.${f.key}`, f.label])),
  };
  // No recipient yet: the text stays good for whoever it goes to.
  const values = {
    ...known,
    salutation: known.salutation ?? sk.templates.variables.defaultSalutation,
  };
  return {
    subject: plainOf(template.subject, values, labels),
    body: filled(template.body, values, labels),
    lookProductId: template.lookProductId,
    lookKind: template.lookKind,
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
  const written = row.body;
  if (!written || !row.subject || !JSON.stringify(written).includes('"text"')) {
    throw new CampaignError('NO_CONTENT');
  }
  const reply = await replyOf(db, row);
  // An answer with nothing but the signature says nothing; a forward may say nothing of its own.
  if (reply && reply.mode !== 'forward') {
    const signature = await signatureNodes(db, row.senderUserId, row.lookKind, row.lookProductId);
    const only = plainOf({ type: 'doc', content: [paragraph(), ...signature] }, {}, {});
    if (plainOf(written, {}, {}).trim() === only.trim()) throw new CampaignError('NO_CONTENT');
  }
  const body: EmailNode = reply
    ? { ...written, content: [...(written.content ?? []), ...quoteNodes(reply.quote)] }
    : written;
  const first = recipients[0]!;
  const { values, customerName } = await valuesFor(
    db,
    { contactId: first.contactId ?? undefined, customerId: first.organizationId ?? undefined },
    row.senderUserId,
    {},
  );
  // One e-mail for everybody on it: the interest it records is that of the first To, if known.
  const carrierId = randomUUID();
  const rendered = await renderEmail({
    look: await lookFor(db, row.lookKind, row.lookProductId),
    baseUrl: env.WEB_URL,
    subject: row.subject,
    body,
    values,
    labels: {},
    // An answer or a forward has the signature in its text, where it could be changed.
    signature: !reply,
    customerName,
    ...(first.organizationId
      ? { activityUrl: (activity: RecordedActivity) => activityUrl(env, carrierId, activity) }
      : {}),
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
            ...(position === 0 ? { id: carrierId } : {}),
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
            fromName: rendered.fromName,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            totalBytes,
            queuedAt: now,
            // The one that is sent carries the threading of an answer.
            inReplyToInboundId:
              position === 0 && reply && reply.mode !== 'forward' ? reply.inboundId : null,
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
