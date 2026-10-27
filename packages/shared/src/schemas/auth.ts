import { z } from 'zod';
import { emailSchema } from './common.js';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * A session ends after an hour without interaction. The open tab logs itself out on a timer; the
 * server refuses a refresh token nobody used for as long, so the rule also holds for a tab that
 * was closed and a browser that was left running.
 */
export const WEB_IDLE_TIMEOUT_MS = 60 * 60_000;

export const forgotPasswordSchema = z.object({ email: emailSchema });

/** At least 10 characters and one digit. */
export const newPasswordSchema = z.string().min(10).max(200).regex(/\d/, 'password_needs_digit');

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPasswordSchema,
});
/** The invited person's first password. */
export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPasswordSchema,
});
export const checkInvitationSchema = z.object({ token: z.string().min(1).max(200) });

/*
 * The second factor, mandatory for everybody. After a right password the login answers a
 * challenge instead of a session: a short-lived signed token that only the second step accepts.
 * `verify` asks for a code of her authenticator (or a recovery code), `enrol` for a setup first,
 * which is where a new user lands right after she sets her password.
 */
export const SECOND_STEPS = ['verify', 'enrol'] as const;
export type SecondStepKind = (typeof SECOND_STEPS)[number];

const challengeSchema = z.string().min(1).max(1000);
/** Six digits of the authenticator, or a recovery code (`k7m2p-x9q4d`, spaces and case forgiven). */
export const secondFactorCodeSchema = z.string().trim().min(6).max(20);
/** A code of the authenticator and nothing else: a setup is confirmed with the app it set up. */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'invalid_totp_code');

/** `auth.secondFactorSetup`: a first setup, still before any session. */
export const secondFactorSetupSchema = z.object({ challenge: challengeSchema });

/** „Zapamätať toto zariadenie“ is the checkbox of the second step. */
export const secondFactorVerifySchema = z.object({
  challenge: challengeSchema,
  code: secondFactorCodeSchema,
  rememberDevice: z.boolean().default(false),
});

export const secondFactorEnrolSchema = z.object({
  challenge: challengeSchema,
  code: totpCodeSchema,
  rememberDevice: z.boolean().default(false),
});
