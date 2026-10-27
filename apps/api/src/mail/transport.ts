import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { isReservedAddress } from './reserved-domain.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** E-mails to customers name their sender; system mail uses `MAIL_FROM`. */
  from?: string;
  replyTo?: string;
  /** `List-Unsubscribe` and `List-Unsubscribe-Post` of an e-mail to customers. */
  headers?: Record<string, string>;
  /** Fetched by the provider from a short-lived signed link: the bytes never pass the API. */
  attachments?: { filename: string; path: string }[];
}

/** What the provider tells us about an accepted message; `null` when nothing left the process. */
export interface SentMail {
  providerMessageId: string | null;
  /**
   * The address is on a reserved domain (`@example.com`, `.test` …): the provider was
   * not asked, because no mail can arrive there. Not a failure, and nothing to retry.
   */
  skipped?: true;
}

/**
 * The provider behind the mailer. One implementation talks to Resend; the other keeps
 * the mail in memory (dev without a key, tests). Templates, links and tokens stay in the mailer,
 * so a second provider would be one more `send`, nothing else.
 */
export interface MailTransport {
  /** `idempotencyKey`: the provider sends at most one message per key, however often it is asked. */
  send(mail: OutgoingMail, idempotencyKey?: string): Promise<SentMail>;
}

/**
 * The provider refused the message. `providerCode` is the provider's own error name
 * (`validation_error`, `rate_limit_exceeded` …): it carries no recipient and no content, so it is
 * what the delivery log keeps. The provider's message is dropped here, it may quote the address.
 */
export class MailProviderError extends Error {
  override readonly name = 'MailProviderError';
  constructor(
    readonly providerCode: string,
    /**
     * The provider refused this very message and would refuse it again: the worker
     * gives up at once instead of asking seven more times over two hours.
     */
    readonly permanent = false,
  ) {
    super(`E-mail provider rejected the message: ${providerCode}`);
  }
}

/**
 * The key errors the Resend SDK names (`RESEND_ERROR_CODE_KEY`): the key is missing, wrong or
 * lacks the right to send. They say nothing about the message.
 */
const KEY_ERRORS = ['missing_api_key', 'invalid_api_key', 'restricted_api_key'];

/**
 * A 4xx is the provider saying no to the message itself: a recipient the test sender may not
 * write to (`validation_error` with 403), a sender that is not
 * verified, a malformed field. Asking again changes nothing, so the worker gives up at once.
 * What passes: 408 (timed out), 409 (a concurrent request with the same idempotency key), 429
 * (rate limit, daily or monthly quota), a 5xx, no status at all (the SDK's answer to a network
 * error), and any 401 or key error: those are about the configuration, not the message, and a
 * key rotated or fixed within the retry window must not have failed every password reset, plan
 * mail and second-factor notice for good.
 */
export function isPermanentRefusal(error: {
  name: string;
  statusCode: number | null | undefined;
}): boolean {
  const { name, statusCode } = error;
  return (
    typeof statusCode === 'number' &&
    statusCode >= 400 &&
    statusCode < 500 &&
    ![401, 408, 409, 429].includes(statusCode) &&
    !KEY_ERRORS.includes(name)
  );
}

/** Mails kept here instead of being sent when no RESEND_API_KEY is configured (dev and tests). */
export const outbox: OutgoingMail[] = [];

export function memoryTransport(options: { quiet: boolean }): MailTransport {
  const logger = new Logger('mailer');
  return {
    send(mail) {
      outbox.push(mail);
      // Subject only: the recipient and the link with its token stay out of the log.
      if (!options.quiet) logger.warn(`not sent, kept in outbox: "${mail.subject}"`);
      return Promise.resolve({ providerMessageId: null });
    },
  };
}

/** The part of the Resend SDK we use, so a test can stand in for it without the network. */
export type ResendEmails = Pick<Resend['emails'], 'send'>;

export function resendTransport(
  config: { apiKey: string; from: string; replyTo: string | undefined },
  // The SDK's base URL is global (`RESEND_BASE_URL` overrides it); the EU region is a property of
  // the sending domain in Resend, not of the client (docs/runbook.md, „E-mail sender domain“).
  emails: ResendEmails = new Resend(config.apiKey).emails,
): MailTransport {
  return {
    async send(mail, idempotencyKey) {
      // Only the real provider skips: the in-memory outbox keeps these, tests read them there.
      if (isReservedAddress(mail.to)) return { providerMessageId: null, skipped: true };
      const { data, error } = await emails.send(
        {
          from: config.from,
          ...(config.replyTo ? { replyTo: config.replyTo } : {}),
          ...mail,
        },
        idempotencyKey ? { idempotencyKey } : {},
      );
      if (error) throw new MailProviderError(error.name, isPermanentRefusal(error));
      return { providerMessageId: data.id };
    },
  };
}
