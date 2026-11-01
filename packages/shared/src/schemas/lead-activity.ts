import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * The seeded types (docs/activity-types.md), with fixed ids. Only a podnet is the system's, what
 * comes from the apps needs it; interest is an ordinary type, gone when nothing uses it.
 */
export const ACTIVITY_TYPE_INTEREST_ID = '00000000-0000-4000-8000-0000000000b1';
export const ACTIVITY_TYPE_FEEDBACK_ID = '00000000-0000-4000-8000-0000000000b2';
/** A draft an outsider sent through a file's public link (docs/file-sharing.md). */
export const ACTIVITY_TYPE_DOCUMENT_CHANGE_ID = '00000000-0000-4000-8000-0000000000b3';
export const SYSTEM_ACTIVITY_TYPE_IDS: readonly string[] = [
  ACTIVITY_TYPE_FEEDBACK_ID,
  ACTIVITY_TYPE_DOCUMENT_CHANGE_ID,
];

/** The product ADOS: a podnet from Alma ADOS is about it (docs/activities-from-apps.md). */
export const ADOS_PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';

/** Where an entry came from: a button in an e-mail, an application, or a shared file. */
export const LEAD_ACTIVITY_SOURCES = ['email', 'app', 'share'] as const;
export type LeadActivitySource = (typeof LEAD_ACTIVITY_SOURCES)[number];

const dayOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Aktivity: newest first, by words, type, product and the days it came in. */
export const leadActivityListSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  search: z.string().trim().max(100).optional(),
  typeId: idSchema.optional(),
  productId: idSchema.optional(),
  from: dayOnly.optional(),
  to: dayOnly.optional(),
});
export type LeadActivityListInput = z.input<typeof leadActivityListSchema>;

export const leadActivityIdSchema = z.object({ id: idSchema });

/** A podnet without a match gets its organization or its contact by hand. */
export const leadActivityAssignSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema.optional(),
    contactId: idSchema.optional(),
  })
  .refine((value) => value.organizationId || value.contactId, { message: 'required' });

const activityTypeFields = {
  name: z.string().trim().min(1, 'required').max(80),
  /** The text of the confirm button; a type with one can be used by a button in an e-mail. */
  confirmLabel: z.string().trim().min(1, 'required').max(80).nullable(),
  asksProduct: z.boolean(),
  active: z.boolean(),
};

export const activityTypeCreateSchema = z.object(activityTypeFields);
export const activityTypeUpdateSchema = z.object({ id: idSchema, ...activityTypeFields });
export type ActivityTypeUpdateInput = z.input<typeof activityTypeUpdateSchema>;

/** The public page behind the e-mail's button: the token from the link's fragment. */
export const interestTokenSchema = z.object({ token: z.string().min(20).max(160) });
