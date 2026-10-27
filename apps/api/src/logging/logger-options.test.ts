import { Writable } from 'node:stream';
import { REDACTED } from '@intra/shared/observability';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from './logger-options.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const { redact = [], level = 'info', formatters = {} } = loggerOptions();
  return { lines, logger: pino({ redact, level, formatters }, stream) };
}

describe('logger options', () => {
  it('redacts personal keys at any depth, and whatever is nested too deep', () => {
    const { lines, logger } = capture();
    logger.warn({
      msg: 'by mistake',
      userId: '00000000-0000-4000-8000-000000000001',
      firstName: 'Jana',
      user: { email: 'jana@example.com', emailSignature: 'S pozdravom' },
      input: { name: 'Jana Horváthová' },
      err: { names: ['Error'], params: ['%Horvath%'] },
      headers: { 'set-cookie': 'intra_at=secret' },
      a: { b: { c: { d: { e: { f: 'Peter' } } } } },
      count: 3,
    });

    const [line] = lines;
    expect(line).toMatchObject({
      msg: 'by mistake',
      userId: '00000000-0000-4000-8000-000000000001',
      firstName: REDACTED,
      user: { email: REDACTED, emailSignature: REDACTED },
      input: REDACTED,
      err: { names: ['Error'], params: REDACTED },
      headers: { 'set-cookie': REDACTED },
      a: { b: { c: { d: { e: REDACTED } } } },
      count: 3,
    });
    expect(JSON.stringify(line)).not.toMatch(/Jana|example\.com|pozdravom|Horvath|secret|Peter/);
  });

  it('keeps ids, codes and counts untouched', () => {
    const { lines, logger } = capture();
    const line = {
      msg: 'mail sent',
      mailId: '5b8a1c2e-3f4d-4e6a-9b7c-1d2e3f4a5b6c',
      kind: 'invitation',
      attempt: 2,
      names: ['TRPCError', 'Error'],
      pgCode: '22021',
    };
    logger.info(line);
    expect(lines[0]).toMatchObject(line);
  });

  it('redacts credentials: the header, keys named token, codes and secrets', () => {
    const { lines, logger } = capture();
    logger.warn({
      msg: 'by mistake',
      request: { headers: { Authorization: 'Bearer re_secret-1', accept: 'application/json' } },
      accessToken: 'secret-2',
      token: 'tok-abc',
      tokenHash: 'f00d',
      code: '123456',
      recoveryCodes: ['k7m2p-x9q4d'],
    });
    expect(lines[0]).toMatchObject({
      request: { headers: { Authorization: REDACTED, accept: 'application/json' } },
      accessToken: REDACTED,
      token: REDACTED,
      tokenHash: REDACTED,
      code: REDACTED,
      recoveryCodes: REDACTED,
    });
    expect(JSON.stringify(lines[0])).not.toMatch(/secret|tok-abc|f00d|123456|k7m2p/);
  });
});
