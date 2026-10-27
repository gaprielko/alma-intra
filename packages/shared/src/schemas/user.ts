import { z } from 'zod';
import { emailSchema, idSchema } from './common.js';
import { profileFields } from './account.js';

/**
 * `invited` until the invitation is accepted, `active`, `deactivated` when a colleague took the
 * access away. Nobody is deleted: the audit trail keeps pointing at them.
 */
export const USER_STATUSES = ['invited', 'active', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** The chips of the user list; `all` is the absence of a filter. */
export const userListSchema = z.object({ status: z.enum(USER_STATUSES).optional() });

export const inviteUserSchema = z.object({ email: emailSchema, ...profileFields });
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** A colleague's details; her e-mail is her login and is not changed here. */
export const updateUserSchema = z.object({ userId: idSchema, ...profileFields });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Deactivate, reactivate, resend or withdraw an invitation, reset the second factor. */
export const userIdSchema = z.object({ userId: idSchema });
