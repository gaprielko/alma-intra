import { expectTypeOf } from 'vitest';
import { loadEnv } from '../config/env.js';
import { createMailer } from './mailer.js';
import type {
  InvitationEmail,
  PasswordResetEmail,
  SecondFactorChangedEmail,
} from './templates.js';
import type { MailTransport, OutgoingMail } from './transport.js';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5434/alma_intra',
  AUTH_ACCESS_SECRET: 'q3VdX0m1Jt8ZpLr5Ny2WbHs7Kc4Fg9AeUo6TiRw+/PzQxMvBnCy',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  WEB_URL: 'https://intra.example.test',
});

/** Renders every template the outbox sends, through the mailer, with a provider that keeps them. */
async function renderAll() {
  const sent: OutgoingMail[] = [];
  const keep: MailTransport = {
    send: (mail) => {
      sent.push(mail);
      return Promise.resolve({ providerMessageId: null });
    },
  };
  const mailer = createMailer(env, keep);
  const to = 'jana@example.com';
  const render = async (name: string, send: () => Promise<unknown>) => {
    await send();
    return [name, sent.at(-1)!] as const;
  };
  return Object.fromEntries([
    await render('invitation by a colleague', () =>
      mailer.sendInvitation(to, 'tok-inv', { invitedByName: 'Peter Kováč' }),
    ),
    await render('first user', () => mailer.sendInvitation(to, 'tok-first', { invitedByName: null })),
    await render('password reset', () => mailer.sendPasswordReset(to, 'tok-reset')),
    await render('second factor enabled', () => mailer.sendSecondFactorChanged(to, 'enabled')),
    await render('second factor replaced', () => mailer.sendSecondFactorChanged(to, 'replaced')),
    await render('second factor reset', () => mailer.sendSecondFactorChanged(to, 'reset')),
  ]);
}

describe('e-mail templates', () => {
  it('have a subject and a body for every kind', async () => {
    const mails = await renderAll();
    for (const mail of Object.values(mails)) {
      expect(mail.subject).toContain('Alma Intra');
      expect(mail.text.length).toBeGreaterThan(100);
    }
    expect(mails['invitation by a colleague']!.text).toContain('Peter Kováč');
    expect(mails['first user']!.text).not.toContain('Peter Kováč');
  });

  it('are Slovak HTML with the plain-text link in both parts', async () => {
    for (const mail of Object.values(await renderAll())) {
      expect(mail.html).toContain('lang="sk"');
      const url = /https:\/\/intra\.example\.test\/\S+/.exec(mail.text)![0];
      expect(mail.html).toContain(url.replaceAll('&', '&amp;'));
    }
  });

  it('take a name or a link, and nothing else', () => {
    // What a template can print is what its props let in, so a new prop is a decision made here,
    // in review, not in passing.
    type Props<T extends (props: never) => unknown> = keyof Parameters<T>[0];
    expectTypeOf<Props<typeof PasswordResetEmail>>().toEqualTypeOf<'url'>();
    expectTypeOf<Props<typeof InvitationEmail>>().toEqualTypeOf<'url' | 'invitedByName'>();
    expectTypeOf<Props<typeof SecondFactorChangedEmail>>().toEqualTypeOf<'url' | 'change'>();
  });
});
