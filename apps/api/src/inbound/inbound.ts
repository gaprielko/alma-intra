import { createHmac } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Resend } from 'resend';
import type { Env } from '../config/env.js';
import type { Db } from '../db/db.module.js';
import { notify } from '../notifications/notifications.service.js';
import {
  campaignMessages,
  campaigns,
  contactLinks,
  contacts,
  organizations,
  inboundMessages,
} from '../db/schema/index.js';

/**
 * Replies in the app (spec 6.6). Every e-mail to a customer goes out with its own Reply-To,
 * `r+<token>@<INBOUND_REPLY_DOMAIN>`; Resend receives the answer and tells the webhook, which
 * fetches it here and files it: by the token under the e-mail it answers, else by the sender's
 * address under a contact, else into „Nepriradené“.
 */

/** A received e-mail as the provider gives it. Untrusted, every field. */
export interface InboundEmail {
  providerEmailId: string;
  from: string;
  to: string[];
  cc: string[];
  /** The addresses the mail was delivered for (`Received` headers): Bcc and forwards included. */
  receivedFor: string[];
  subject: string;
  html: string | null;
  text: string | null;
  headerMessageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  attachments: { id: string; filename: string; contentType: string; size: number }[];
  receivedAt: Date;
}

/** An attachment of a received e-mail with a link to its bytes, valid about an hour. */
export interface InboundAttachmentLink {
  id: string;
  downloadUrl: string;
}

/** Where received e-mails are fetched from: Resend, or nothing in dev without a key. */
export interface InboundSource {
  get(providerEmailId: string): Promise<InboundEmail | null>;
  attachmentLinks(providerEmailId: string): Promise<InboundAttachmentLink[]>;
  /** The received e-mail as it came, to another address (once per key). */
  forward(providerEmailId: string, mail: { to: string; from: string }, key: string): Promise<void>;
  /** The ids of the latest received e-mails, newest first (at most 100). */
  recent(): Promise<string[]>;
}

/** The provider did not give the e-mail: the webhook answers 5xx and Resend tries again. */
export class InboundFetchError extends Error {
  override readonly name = 'InboundFetchError';
  constructor(readonly providerCode: string) {
    super(`Received e-mail not fetched: ${providerCode}`);
  }
}

/** The part of the Resend SDK we use, so a test can stand in for it. */
export type ResendReceiving = Pick<
  Resend['emails']['receiving'],
  'get' | 'attachments' | 'forward' | 'list'
>;

const header = (headers: Record<string, string> | null, name: string) => {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key]!.trim() || null : null;
};

export function resendInboundSource(
  apiKey: string,
  receiving: ResendReceiving = new Resend(apiKey).emails.receiving,
): InboundSource {
  return {
    async get(id) {
      // Inline images stay `cid:` references: the page shows none of them unless asked.
      const { data, error } = await receiving.get(id, { html_format: 'cid' });
      if (error) {
        if (error.statusCode === 404) return null;
        throw new InboundFetchError(error.name);
      }
      return {
        providerEmailId: data.id,
        from: data.from,
        to: data.to ?? [],
        cc: data.cc ?? [],
        receivedFor: data.received_for ?? [],
        subject: data.subject ?? '',
        html: data.html,
        text: data.text,
        headerMessageId: data.message_id || header(data.headers, 'message-id'),
        inReplyTo: header(data.headers, 'in-reply-to'),
        references: header(data.headers, 'references'),
        attachments: (data.attachments ?? []).map((a) => ({
          id: a.id,
          filename: a.filename ?? 'priloha',
          contentType: a.content_type,
          size: a.size,
        })),
        receivedAt: new Date(data.created_at),
      };
    },
    async attachmentLinks(id) {
      const { data, error } = await receiving.attachments.list({ emailId: id });
      if (error) throw new InboundFetchError(error.name);
      return data.data.map((a) => ({ id: a.id, downloadUrl: a.download_url }));
    },
    async forward(id, mail, key) {
      const { error } = await receiving.forward(
        { emailId: id, to: mail.to, from: mail.from },
        { idempotencyKey: key },
      );
      if (error) throw new InboundFetchError(error.name);
    },
    async recent() {
      const { data, error } = await receiving.list({ limit: 100 });
      if (error) throw new InboundFetchError(error.name);
      return data.data.map((email) => email.id);
    },
  };
}

let fromEnv: InboundSource | null | undefined;
/** The source for this process: Resend with the configured key, or none without one. */
export function inboundSource(env: Pick<Env, 'RESEND_API_KEY'>): InboundSource | null {
  if (fromEnv === undefined)
    fromEnv = env.RESEND_API_KEY ? resendInboundSource(env.RESEND_API_KEY) : null;
  return fromEnv;
}

/**
 * The token of a message's Reply-To. Lower-case hex: some mail servers lower-case the local part,
 * and a token must survive them. 96 bits, derived from the message id, so it needs no storage to
 * be made and cannot be guessed from the id.
 */
export function replyToken(env: Pick<Env, 'DATA_ENCRYPTION_KEY'>, messageId: string) {
  return createHmac('sha256', env.DATA_ENCRYPTION_KEY)
    .update(`reply:${messageId}`)
    .digest('hex')
    .slice(0, 24);
}

/** `r+<token>@<domain>`, or null when replies do not come back to Intra. */
export function replyAddress(
  env: Pick<Env, 'DATA_ENCRYPTION_KEY' | 'INBOUND_REPLY_DOMAIN'>,
  messageId: string,
) {
  return env.INBOUND_REPLY_DOMAIN
    ? `r+${replyToken(env, messageId)}@${env.INBOUND_REPLY_DOMAIN}`
    : null;
}

/** The bare address of `Eva Tóthová <eva@ados.sk>`, lower-cased, and the name if there is one. */
export function parseAddress(raw: string): { email: string; name: string | null } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  const email = (match ? match[2]! : raw).trim().toLowerCase();
  const name = match?.[1]?.trim() || null;
  return { email, name };
}

/** The reply token among the addresses, when one of them is `r+<token>@<domain>`. */
export function tokenIn(addresses: readonly string[], domain: string | undefined) {
  if (!domain) return null;
  for (const raw of addresses) {
    const { email } = parseAddress(raw);
    const match = /^r\+([0-9a-f]{24})@(.+)$/.exec(email);
    if (match && match[2] === domain.toLowerCase()) return match[1]!;
  }
  return null;
}

/**
 * Who a mail is from, by the address: the live person with it at their one organization, else one
 * live organization's own address. A person at several organizations stays for a colleague to file.
 */
async function bySender(db: Db, email: string) {
  const people = await db
    .select({ contactId: contacts.id, customerId: contactLinks.organizationId })
    .from(contacts)
    .innerJoin(contactLinks, eq(contactLinks.contactId, contacts.id))
    .innerJoin(organizations, eq(organizations.id, contactLinks.organizationId))
    .where(
      and(
        sql`lower(${contacts.email}) = ${email}`,
        isNull(contacts.deletedAt),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(2);
  if (people.length === 1)
    return { customerId: people[0]!.customerId, contactId: people[0]!.contactId };
  if (people.length > 1) return null;
  const records = await db
    .select({ customerId: organizations.id })
    .from(organizations)
    .where(and(sql`lower(${organizations.email}) = ${email}`, isNull(organizations.deletedAt)))
    .limit(2);
  return records.length === 1 ? { customerId: records[0]!.customerId, contactId: null } : null;
}

/**
 * Files a received e-mail, once (by the provider's id): under the message its token names, else
 * under the one contact or customer with the sender's address, else as „Nepriradené“. Answers
 * the row's id and how it was matched; a repeat answers the stored row.
 */
export async function receiveInbound(
  db: Db,
  env: Pick<Env, 'INBOUND_REPLY_DOMAIN'>,
  email: InboundEmail,
) {
  const [known] = await db
    .select({ id: inboundMessages.id, status: inboundMessages.status })
    .from(inboundMessages)
    .where(eq(inboundMessages.providerEmailId, email.providerEmailId));
  if (known) return { id: known.id, matched: null, repeated: true, userId: null };

  const sender = parseAddress(email.from);
  const token = tokenIn([...email.to, ...email.cc, ...email.receivedFor], env.INBOUND_REPLY_DOMAIN);
  const [original] = token
    ? await db
        .select({
          id: campaignMessages.id,
          customerId: campaignMessages.organizationId,
          contactId: campaignMessages.contactId,
          userId: campaigns.senderUserId,
        })
        .from(campaignMessages)
        .innerJoin(campaigns, eq(campaigns.id, campaignMessages.campaignId))
        .where(eq(campaignMessages.replyToken, token))
    : [];
  const match = original
    ? { by: 'token' as const, ...original }
    : await bySender(db, sender.email).then((found) =>
        found ? { by: 'sender' as const, id: null, userId: null, ...found } : null,
      );

  const [row] = await db
    .insert(inboundMessages)
    .values({
      providerEmailId: email.providerEmailId,
      messageId: match?.id ?? null,
      organizationId: match?.customerId ?? null,
      contactId: match?.contactId ?? null,
      userId: match?.userId ?? null,
      status: match ? 'assigned' : 'unassigned',
      fromEmail: sender.email,
      fromName: sender.name,
      toEmails: email.to.map((a) => parseAddress(a).email),
      ccEmails: email.cc.map((a) => parseAddress(a).email),
      subject: email.subject.slice(0, 998),
      html: email.html,
      text: email.text,
      headerMessageId: email.headerMessageId,
      inReplyTo: email.inReplyTo,
      references: email.references,
      attachments: email.attachments,
      receivedAt: email.receivedAt,
    })
    .onConflictDoNothing()
    .returning({ id: inboundMessages.id });
  if (!row) return { id: null, matched: null, repeated: true, userId: null };
  // Told: the colleague who sent the e-mail it answers, else whoever has the customer in hand.
  const userId =
    match?.userId ??
    (match
      ? ((
          await db
            .select({ ownerUserId: organizations.ownerUserId })
            .from(organizations)
            .where(eq(organizations.id, match.customerId))
        )[0]?.ownerUserId ?? null)
      : null);
  await notify(db, {
    userId,
    kind: 'reply',
    refId: row.id,
    customerId: match?.customerId ?? null,
    subject: email.subject.slice(0, 200),
  });
  return { id: row.id, matched: match?.by ?? null, repeated: false, userId };
}
