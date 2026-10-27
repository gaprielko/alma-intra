import {
  InboundFetchError,
  parseAddress,
  replyAddress,
  replyToken,
  resendInboundSource,
  type ResendReceiving,
  tokenIn,
} from './inbound.js';

const env = {
  DATA_ENCRYPTION_KEY: 'a'.repeat(44),
  INBOUND_REPLY_DOMAIN: 'mail.alma-care.eu',
};
const MESSAGE = '3f0c1b8e-4c2d-4f5a-9b7e-2d1c0a9e8f7b';

describe('reply addresses', () => {
  it('give each message its own lower-case token on the inbound domain', () => {
    const token = replyToken(env, MESSAGE);
    expect(token).toMatch(/^[0-9a-f]{24}$/);
    expect(replyToken(env, MESSAGE)).toBe(token);
    expect(replyToken(env, '00000000-0000-4000-8000-000000000001')).not.toBe(token);
    expect(replyAddress(env, MESSAGE)).toBe(`r+${token}@mail.alma-care.eu`);
  });

  it('are none without an inbound domain: replies go to the sender', () => {
    expect(replyAddress({ ...env, INBOUND_REPLY_DOMAIN: undefined }, MESSAGE)).toBeNull();
  });
});

describe('parseAddress', () => {
  it('splits a name from the address and lower-cases the address', () => {
    expect(parseAddress('Eva Tóthová <Eva.Tothova@ADOS.sk>')).toEqual({
      email: 'eva.tothova@ados.sk',
      name: 'Eva Tóthová',
    });
    expect(parseAddress('"Novák, Ján" <jan@novak.sk>')).toEqual({
      email: 'jan@novak.sk',
      name: 'Novák, Ján',
    });
    expect(parseAddress('jan@novak.sk')).toEqual({ email: 'jan@novak.sk', name: null });
  });
});

describe('tokenIn', () => {
  const token = replyToken(env, MESSAGE);

  it('finds the token among the recipients, in any case', () => {
    expect(
      tokenIn(
        ['info@alma-care.eu', `Alma <R+${token.toUpperCase()}@Mail.Alma-Care.eu>`],
        env.INBOUND_REPLY_DOMAIN,
      ),
    ).toBe(token);
  });

  it('ignores another domain, a malformed token and a missing domain', () => {
    expect(tokenIn([`r+${token}@evil.example`], env.INBOUND_REPLY_DOMAIN)).toBeNull();
    expect(tokenIn(['r+xyz@mail.alma-care.eu'], env.INBOUND_REPLY_DOMAIN)).toBeNull();
    expect(tokenIn([`r+${token}@mail.alma-care.eu`], undefined)).toBeNull();
  });
});

describe('resendInboundSource', () => {
  const received = {
    object: 'email' as const,
    id: 'em_1',
    to: ['r+abc@mail.alma-care.eu'],
    from: 'Eva <eva@ados.sk>',
    created_at: '2026-10-28T08:00:00.000Z',
    subject: 'Re: Ponuka',
    bcc: null,
    cc: null,
    reply_to: null,
    received_for: ['r+abc@mail.alma-care.eu'],
    html: '<p>Ďakujem</p>',
    text: 'Ďakujem',
    headers: { 'In-Reply-To': '<x@resend.dev>', References: '<x@resend.dev>' },
    message_id: '<y@ados.sk>',
    attachments: [
      {
        id: 'att_1',
        filename: 'zmluva.pdf',
        content_type: 'application/pdf',
        content_disposition: 'attachment',
        content_id: null,
        size: 1200,
      },
    ],
  };

  it('maps the provider fields, headers by any case', async () => {
    const receiving = {
      get: () => Promise.resolve({ data: received, error: null }),
    } as unknown as ResendReceiving;
    const email = await resendInboundSource('re_x', receiving).get('em_1');
    expect(email).toMatchObject({
      providerEmailId: 'em_1',
      cc: [],
      inReplyTo: '<x@resend.dev>',
      references: '<x@resend.dev>',
      headerMessageId: '<y@ados.sk>',
      attachments: [
        { id: 'att_1', filename: 'zmluva.pdf', contentType: 'application/pdf', size: 1200 },
      ],
    });
    expect(email?.receivedAt.toISOString()).toBe('2026-10-28T08:00:00.000Z');
  });

  it('answers null for an unknown e-mail and throws when the provider fails', async () => {
    const answer = (statusCode: number) =>
      ({
        get: () =>
          Promise.resolve({ data: null, error: { name: 'not_found', statusCode, message: '' } }),
      }) as unknown as ResendReceiving;
    expect(await resendInboundSource('re_x', answer(404)).get('em_1')).toBeNull();
    await expect(resendInboundSource('re_x', answer(500)).get('em_1')).rejects.toBeInstanceOf(
      InboundFetchError,
    );
  });
});
