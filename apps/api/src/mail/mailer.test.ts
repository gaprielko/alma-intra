import { loadEnv } from '../config/env.js';
import { createMailer, outbox } from './mailer.js';
import {
  isPermanentRefusal,
  MailProviderError,
  type ResendEmails,
  resendTransport,
} from './transport.js';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5434/alma_intra',
  AUTH_ACCESS_SECRET: 'q3VdX0m1Jt8ZpLr5Ny2WbHs7Kc4Fg9AeUo6TiRw+/PzQxMvBnCy',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  WEB_URL: 'https://intra.example.test',
};

describe('mailer without a provider key', () => {
  beforeEach(() => {
    outbox.length = 0;
  });

  it('renders the password reset e-mail with a link to the web app', async () => {
    await createMailer(loadEnv(baseEnv)).sendPasswordReset('eva@example.com', 'tok en/123');

    expect(outbox).toHaveLength(1);
    const mail = outbox[0]!;
    expect(mail.to).toBe('eva@example.com');
    expect(mail.subject).toContain('Alma Intra');
    const url = 'https://intra.example.test/reset-password#tok%20en%2F123';
    expect(mail.html).toContain(url);
    expect(mail.text).toContain(url);
    expect(mail.text).toContain('60 minút');
  });

  it('renders the invitation with who sent it and its validity', async () => {
    await createMailer(loadEnv(baseEnv)).sendInvitation('nova@example.com', 'abc', {
      invitedByName: 'Peter Kováč',
    });

    const mail = outbox[0]!;
    expect(mail.text).toContain('https://intra.example.test/activate#abc');
    expect(mail.text).toContain('Peter Kováč');
    expect(mail.text).toContain('72 hodín');
  });

  it('refuses to start in production without a key', () => {
    expect(() => createMailer(loadEnv({ ...baseEnv, NODE_ENV: 'production' }))).toThrow(
      /RESEND_API_KEY/,
    );
  });
});

describe('the Resend transport', () => {
  type Payload = Parameters<ResendEmails['send']>[0];
  // A domain that is not reserved: mail to `@example.com` never reaches the provider.
  const mail = { to: 'eva@ados-lubovna.sk', subject: 'S', html: '<p>h</p>', text: 't' };

  function fakeResend(answer: Awaited<ReturnType<ResendEmails['send']>>) {
    const calls: { payload: Payload; options: unknown }[] = [];
    const emails: ResendEmails = {
      send: (payload, options) => {
        calls.push({ payload, options });
        return Promise.resolve(answer);
      },
    };
    return { calls, emails };
  }

  it('sends from MAIL_FROM with the support reply-to and returns the provider id', async () => {
    const { calls, emails } = fakeResend({ data: { id: 're_1' }, error: null, headers: null });
    const transport = resendTransport(
      { apiKey: 're_x', from: 'Alma <noreply@adosalma.sk>', replyTo: 'podpora@adosalma.sk' },
      emails,
    );

    expect(await transport.send(mail, 'mail-outbox/1/1')).toEqual({ providerMessageId: 're_1' });
    expect(calls).toEqual([
      {
        payload: { from: 'Alma <noreply@adosalma.sk>', replyTo: 'podpora@adosalma.sk', ...mail },
        options: { idempotencyKey: 'mail-outbox/1/1' },
      },
    ]);
  });

  it('sends no Reply-To when none is configured', async () => {
    const { calls, emails } = fakeResend({ data: { id: 're_2' }, error: null, headers: null });
    await resendTransport({ apiKey: 're_x', from: 'a@b.sk', replyTo: undefined }, emails).send(
      mail,
    );
    expect(calls[0]!.payload).not.toHaveProperty('replyTo');
  });

  it("turns a refusal into the provider's code, without its message", async () => {
    const { emails } = fakeResend({
      data: null,
      error: {
        name: 'validation_error',
        message: 'Invalid `to` field: eva@ados-lubovna.sk',
        statusCode: 422,
      },
      headers: null,
    });
    const refused = resendTransport(
      { apiKey: 're_x', from: 'a@b.sk', replyTo: undefined },
      emails,
    ).send(mail);
    await expect(refused).rejects.toBeInstanceOf(MailProviderError);
    await expect(refused).rejects.toMatchObject({
      providerCode: 'validation_error',
      permanent: true,
    });
    await expect(refused).rejects.not.toThrow(/eva@ados-lubovna\.sk/);
  });

  it('passes the error name along: a wrong key is retried, the staging recipient is not', async () => {
    const send = (name: 'invalid_api_key' | 'validation_error') =>
      resendTransport(
        { apiKey: 're_x', from: 'a@b.sk', replyTo: undefined },
        fakeResend({ data: null, error: { name, message: 'm', statusCode: 403 }, headers: null })
          .emails,
      ).send(mail);
    await expect(send('invalid_api_key')).rejects.toMatchObject({ permanent: false });
    await expect(send('validation_error')).rejects.toMatchObject({ permanent: true });
  });

  describe('which refusal is for good', () => {
    const refusal = (statusCode: number | null | undefined, name = 'validation_error') => ({
      name,
      statusCode,
    });

    it('the message itself was refused: given up at once', () => {
      // The staging case: the Resend test sender may not write to this recipient.
      expect(isPermanentRefusal(refusal(403))).toBe(true);
      for (const status of [400, 404, 422, 451])
        expect(isPermanentRefusal(refusal(status))).toBe(true);
      expect(isPermanentRefusal(refusal(422, 'invalid_from_address'))).toBe(true);
    });

    it('timed out, a concurrent idempotent request, a rate limit, an outage, no answer: retried', () => {
      for (const status of [408, 409, 429, 500, 503, null, undefined])
        expect(isPermanentRefusal(refusal(status, 'application_error'))).toBe(false);
    });

    it('any 401: retried, it is the key and not the message', () => {
      expect(isPermanentRefusal(refusal(401))).toBe(false);
      expect(isPermanentRefusal(refusal(401, 'missing_api_key'))).toBe(false);
    });

    it('a key error with 403 or any other status: retried, a key rotation must not fail mail for good', () => {
      expect(isPermanentRefusal(refusal(403, 'invalid_api_key'))).toBe(false);
      expect(isPermanentRefusal(refusal(403, 'restricted_api_key'))).toBe(false);
      expect(isPermanentRefusal(refusal(422, 'missing_api_key'))).toBe(false);
    });
  });

  it('never asks the provider to deliver to a reserved domain', async () => {
    const { calls, emails } = fakeResend({ data: { id: 're_3' }, error: null, headers: null });
    const transport = resendTransport(
      { apiKey: 're_x', from: 'a@b.sk', replyTo: undefined },
      emails,
    );

    expect(await transport.send({ ...mail, to: 'eva@example.com' }, 'k')).toEqual({
      providerMessageId: null,
      skipped: true,
    });
    expect(await transport.send({ ...mail, to: 'eva@notexample.com' }, 'k')).toEqual({
      providerMessageId: 're_3',
    });
    expect(calls.map((call) => call.payload.to)).toEqual(['eva@notexample.com']);
  });

  it('reads the reply-to from the environment, info@alma-care.eu unless set', () => {
    expect(loadEnv(baseEnv).MAIL_REPLY_TO).toBe('info@alma-care.eu');
    expect(loadEnv({ ...baseEnv, MAIL_REPLY_TO: '' }).MAIL_REPLY_TO).toBe('');
  });
});
