import { z } from 'zod';
import { idSchema } from './common.js';
import { customFieldSchema, emailDocSchema } from './email-template.js';

/**
 * A send: a draft while the wizard runs, `sending` while its messages leave, `sent` once none is
 * waiting. `scheduled` comes with scheduled sending (D-12, E8).
 */
export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * One recipient's e-mail. `skipped`: left out when sending (unsubscribed, no or a bad address);
 * `failed`: the provider refused it for good. The rest follow Resend's webhooks.
 */
export const MESSAGE_STATUSES = [
  'draft',
  'skipped',
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Why a recipient is left out, shown as a badge in the wizard. */
export const SKIP_REASONS = ['unsubscribed', 'no_email', 'bounced'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Resend accepts at most 40 MB per message, attachments included (D-26). */
export const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

/** A new draft, for these customers (from the list or a detail), or for nobody yet. */
export const createCampaignSchema = z.object({
  customerIds: z.array(idSchema).max(100).default([]),
  /** Files every recipient gets („Priložiť k e-mailu“ from a file). */
  fileIds: z.array(idSchema).max(20).default([]),
});

export const campaignIdSchema = z.object({ id: idSchema });

/** „Nový e-mail“: who it goes to; a contact or organization only when known in Kontakty. */
export const DIRECT_ROLES = ['to', 'cc', 'bcc'] as const;
export const directRecipientSchema = z.object({
  role: z.enum(DIRECT_ROLES),
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(300).nullable(),
  contactId: idSchema.nullable(),
  organizationId: idSchema.nullable(),
});
export type DirectRecipient = z.infer<typeof directRecipientSchema>;
export const saveDirectSchema = z.object({
  id: idSchema,
  recipients: z.array(directRecipientSchema).max(100),
  subject: z.string().trim().max(998),
  body: emailDocSchema,
  templateId: idSchema.nullable(),
  attachmentFileIds: z.array(idSchema).max(20),
});
export type SaveDirectInput = z.infer<typeof saveDirectSchema>;
export const directFromTemplateSchema = z.object({
  templateId: idSchema,
  contactId: idSchema.nullable(),
  organizationId: idSchema.nullable(),
});

/** The review step's switch: files as download links valid 30 days (D-26). */
export const attachmentsAsLinksSchema = z.object({ id: idSchema, asLinks: z.boolean() });

/** How far ahead an e-mail can be scheduled (D-12). */
export const MAX_SCHEDULE_DAYS = 90;

/** „Odoslať“: now, or at a time (an ISO instant at least a few minutes ahead). */
export const sendCampaignSchema = z.object({
  id: idSchema,
  at: z.string().datetime({ offset: true }).optional(),
});

/** A recipient: a contact of an organization, or a private person (no contact). */
export const recipientSchema = z.object({
  customerId: idSchema,
  contactId: idSchema.nullable(),
});
export const setRecipientsSchema = z.object({
  id: idSchema,
  recipients: z.array(recipientSchema).max(500),
});

/** The customers a picker offers, with their contacts and why one would be left out. */
export const recipientCandidatesSchema = z.object({ customerIds: z.array(idSchema).max(500) });

export const chooseTemplateSchema = z.object({
  id: idSchema,
  /** `null`: an empty e-mail. */
  templateId: idSchema.nullable(),
});

/** Step 3: what everybody gets. */
export const campaignContentSchema = z.object({
  id: idSchema,
  subject: emailDocSchema,
  body: emailDocSchema,
  customFields: z.array(customFieldSchema).max(20),
  commonValues: z.record(z.string().max(500)).default({}),
  attachmentFileIds: z.array(idSchema).max(10).default([]),
});

/** One recipient's own values, own attachments, and their own text (`null`: the common one). */
export const recipientContentSchema = z.object({
  messageId: idSchema,
  values: z.record(z.string().max(500)).default({}),
  ownFileIds: z.array(idSchema).max(10).default([]),
  bodyOverride: emailDocSchema.nullable().optional(),
});

export const messagePreviewSchema = z.object({ messageId: idSchema });
export const campaignListSchema = z.object({
  status: z.enum(['sent', 'draft']),
  page: z.number().int().min(1).max(10_000).default(1),
});

/** The public unsubscribe page: the token from the link's fragment. */
export const unsubscribeTokenSchema = z.object({ token: z.string().min(20).max(100) });
export const UNSUBSCRIBE_REASONS = [
  'too_many',
  'not_interested',
  'left_position',
  'other',
] as const;
export const unsubscribeSchema = unsubscribeTokenSchema.extend({
  reason: z.enum(UNSUBSCRIBE_REASONS).optional(),
});
