import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * What a customer or a partner did on their own (docs/activities.md); a colleague's calls and
 * meetings are `activities`. Only one type so far.
 */
export const LEAD_ACTIVITY_TYPES = ['product_interest'] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

const dayOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Aktivity: newest first, by words, type, product and the days it came in. */
export const leadActivityListSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  search: z.string().trim().max(100).optional(),
  type: z.enum(LEAD_ACTIVITY_TYPES).optional(),
  productId: idSchema.optional(),
  from: dayOnly.optional(),
  to: dayOnly.optional(),
});
export type LeadActivityListInput = z.input<typeof leadActivityListSchema>;

export const leadActivityIdSchema = z.object({ id: idSchema });

/** The public page behind the e-mail's button: the token from the link's fragment. */
export const interestTokenSchema = z.object({ token: z.string().min(20).max(120) });
