import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
  it('keeps the Postgres code and drops the message with SQL and parameters', () => {
    const pg = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), {
      code: '22021',
    });
    // tRPC wraps what the resolver threw; Drizzle wraps what the driver threw.
    const failed = new Error('Failed query: select … where name ilike $1 params: %Novak%', {
      cause: pg,
    });

    const described = describeError(failed);
    expect(described).toEqual({ names: ['Error', 'Error'], pgCode: '22021' });
    expect(JSON.stringify(described)).not.toMatch(/Novak|select|invalid byte/);
  });
});
