import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Where an e-mail that came back stands: on a customer's timeline, waiting in „Nepriradené“ for
 * somebody to assign it, or put aside.
 */
export const INBOUND_STATUSES = ['assigned', 'unassigned', 'discarded'] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

export const inboundIdSchema = z.object({ id: idSchema });

/** „Prijaté“: the unassigned first, or everything received; discarded mail is never listed. */
export const INBOUND_VIEWS = ['unassigned', 'all'] as const;
export const inboundListSchema = z.object({
  view: z.enum(INBOUND_VIEWS).default('unassigned'),
  page: z.number().int().min(1).max(10_000).default(1),
  /**
   * Full text over everything known of an e-mail: the sender, the contact and organization it is
   * filed under, the subject, the text and the attachments' names; within the filters below.
   */
  search: z.string().trim().min(1).max(100).optional(),
  /** Only an organization's e-mails (with its prevádzky'), or a person's. */
  customerId: idSchema.optional(),
  contactId: idSchema.optional(),
  /** Only e-mails with attachments. */
  withAttachments: z.boolean().optional(),
});
export type InboundListInput = z.input<typeof inboundListSchema>;

/** Files an e-mail under a customer (and one of its contact persons), from „Nepriradené“ or not. */
export const assignInboundSchema = z.object({
  id: idSchema,
  customerId: idSchema,
  contactId: idSchema.nullable().default(null),
});

/**
 * What a colleague is told about in the app: a reply to their e-mail, or an e-mail of theirs that
 * bounced.
 */
export const NOTIFICATION_KINDS = ['reply', 'bounce', 'next_step'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Marks notifications read: the listed ones, or all of them. */
export const markNotificationsSchema = z.object({ ids: z.array(idSchema).max(100).optional() });

/** „Odpovedať“: the answer's own text; the quoted e-mail is added below it. */
export const replyInboundSchema = z.object({
  id: idSchema,
  text: z.string().trim().min(1).max(10_000),
});
