import { z } from 'zod';
import { newPasswordSchema, secondFactorCodeSchema, totpCodeSchema } from './auth.js';
import { phoneSchema } from './common.js';

/** The fields of a person's details: one's own on „Môj účet“, a colleague's in Settings. */
export const profileFields = {
  name: z.string().trim().min(2).max(120),
  /** Optional; an empty string clears it. */
  phone: phoneSchema.or(z.literal('')).optional(),
  position: z.string().trim().max(120).optional(),
};

/** „Môj účet“: one's own details and e-mail signature. The login e-mail is not changed here. */
export const updateProfileSchema = z.object({
  ...profileFields,
  /** Plain text appended to e-mails to customers; an empty string clears it. */
  emailSignature: z.string().max(1000).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** The current password, and the new one twice. The session stays; her other sessions end. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: newPasswordSchema,
    repeatPassword: z.string().max(200),
  })
  .refine((p) => p.newPassword === p.repeatPassword, {
    path: ['repeatPassword'],
    message: 'password_mismatch',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Moving the second factor to a new phone asks for her password and a code of the factor in force
 * (or a recovery code), so that a stolen session with a phished password cannot take the factor
 * over. The factor itself cannot be switched off: it is mandatory.
 */
export const accountSecondFactorSetupSchema = z.object({
  password: z.string().min(1).max(200),
  code: secondFactorCodeSchema,
});
export const accountSecondFactorConfirmSchema = z.object({ code: totpCodeSchema });
/** New recovery codes replace the old ones; her password first. */
export const accountRecoveryCodesSchema = z.object({ password: z.string().min(1).max(200) });

/** One of her own sessions, ended from „Aktívne prihlásenia“. */
export const endSessionSchema = z.object({ sessionId: z.string().uuid() });

/** How long a personal access token for Claude Code lives, in days. */
export const ACCESS_TOKEN_DAYS = [30, 90, 365] as const;
export const createAccessTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  days: z.union([z.literal(30), z.literal(90), z.literal(365)]),
});
export const accessTokenIdSchema = z.object({ id: z.string().uuid() });

/** The consent page: the pending OAuth request it answers. */
export const oauthRequestSchema = z.object({ request: z.string().uuid() });
export const oauthDecisionSchema = z.object({ request: z.string().uuid(), approve: z.boolean() });
