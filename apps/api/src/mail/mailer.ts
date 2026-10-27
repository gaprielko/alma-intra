import { sk } from '@intra/shared/i18n';
import { render } from '@react-email/components';
import type { ReactElement } from 'react';
import { Logger } from '@nestjs/common';
import type { Env } from '../config/env.js';
import type { SecondFactorChange } from '../db/schema/mail-outbox.js';
import { InvitationEmail, PasswordResetEmail, SecondFactorChangedEmail } from './templates.js';
import {
  type MailTransport,
  memoryTransport,
  type OutgoingMail,
  resendTransport,
  type SentMail,
} from './transport.js';

export { outbox, type OutgoingMail, type SentMail } from './transport.js';

/**
 * What the outbox worker calls: one method per template, and every argument is a name or a link.
 * Kept free of Resend/React types so the tRPC client does not compile them.
 */
export interface Mailer {
  /** `idempotencyKey`: the provider sends at most one message per key, however often it is asked. */
  sendPasswordReset(to: string, token: string, idempotencyKey?: string): Promise<SentMail>;
  sendInvitation(
    to: string,
    token: string,
    /** `invitedByName: null`: the first user, created from the command line. */
    invitation: { invitedByName: string | null },
    idempotencyKey?: string,
  ): Promise<SentMail>;
  /** Her second factor changed. What changed, never a secret or a code. */
  sendSecondFactorChanged(
    to: string,
    change: SecondFactorChange,
    idempotencyKey?: string,
  ): Promise<SentMail>;
}

// The token rides in the URL fragment: browsers never send a fragment to a server, so it stays out
// of web-server, CDN and proxy logs and out of Referer headers.
const link = (env: Env, path: string, token: string) =>
  `${env.WEB_URL}${path}#${encodeURIComponent(token)}`;

/** Resend with a key; without one the in-memory outbox, which production refuses. */
export function transportFor(env: Env): MailTransport {
  if (!env.RESEND_API_KEY && env.NODE_ENV === 'production') {
    throw new Error('RESEND_API_KEY is required in production');
  }
  const logger = new Logger('mailer');
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV !== 'test') {
      logger.warn(
        'RESEND_API_KEY is empty: e-mails are NOT sent, they stay in the in-memory outbox',
      );
    }
    return memoryTransport({ quiet: env.NODE_ENV === 'test' });
  }
  if (env.MAIL_FROM.includes('@resend.dev')) {
    logger.warn('MAIL_FROM is the Resend test sender: only the Resend account owner receives mail');
  }
  return resendTransport({
    apiKey: env.RESEND_API_KEY,
    from: env.MAIL_FROM,
    replyTo: env.MAIL_REPLY_TO || undefined,
  });
}

/** `transport`: tests hand in their own provider; everything else gets the one `env` names. */
export function createMailer(env: Env, transport: MailTransport = transportFor(env)): Mailer {
  async function send(
    to: string,
    subject: string,
    element: ReactElement,
    idempotencyKey: string | undefined,
  ): Promise<SentMail> {
    const mail: OutgoingMail = {
      to,
      subject,
      html: await render(element),
      text: await render(element, { plainText: true }),
    };
    return transport.send(mail, idempotencyKey);
  }

  return {
    sendPasswordReset: (to, token, idempotencyKey) =>
      send(
        to,
        sk.email.passwordReset.subject,
        PasswordResetEmail({ url: link(env, '/reset-password', token) }),
        idempotencyKey,
      ),
    sendInvitation: (to, token, invitation, idempotencyKey) =>
      send(
        to,
        sk.email.invitation.subject,
        InvitationEmail({ url: link(env, '/activate', token), ...invitation }),
        idempotencyKey,
      ),
    sendSecondFactorChanged: (to, change, idempotencyKey) =>
      send(
        to,
        sk.email.secondFactorChanged.subject,
        SecondFactorChangedEmail({ url: `${env.WEB_URL}/login`, change }),
        idempotencyKey,
      ),
  };
}
