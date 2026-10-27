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
});
export type InboundListInput = z.input<typeof inboundListSchema>;

/** Files an e-mail under a customer (and one of its contact persons), from „Nepriradené“ or not. */
export const assignInboundSchema = z.object({
  id: idSchema,
  customerId: idSchema,
  contactId: idSchema.nullable().default(null),
});
