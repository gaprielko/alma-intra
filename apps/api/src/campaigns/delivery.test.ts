import { describe, expect, it } from 'vitest';
import { replyToFor } from './delivery.js';

const SENDER = 'jana.horvathova@example.com';
const INBOUND = 'r+abc@mail.alma-care.eu';

describe('replyToFor', () => {
  it('sends replies to the company address', () => {
    const look = { replyMode: 'company', replyToAddress: 'info@alma-care.eu' } as const;
    expect(replyToFor(look, null, SENDER)).toBe('info@alma-care.eu');
  });

  it('sends replies back to Intra on the message address', () => {
    const look = { replyMode: 'intra', replyToAddress: 'info@alma-care.eu' } as const;
    expect(replyToFor(look, INBOUND, SENDER)).toBe(INBOUND);
  });

  it('falls back to the sender while no inbound domain is set', () => {
    const look = { replyMode: 'intra', replyToAddress: 'info@alma-care.eu' } as const;
    expect(replyToFor(look, null, SENDER)).toBe(SENDER);
  });

  it('sends replies to the sender', () => {
    const look = { replyMode: 'sender', replyToAddress: 'info@alma-care.eu' } as const;
    expect(replyToFor(look, INBOUND, SENDER)).toBe(SENDER);
  });
});
