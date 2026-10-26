import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import { breachCheckFor } from './breach-check.module.js';

const env = (values: Partial<Env>) => values as Env;

describe('which breached-password check the API runs (ALMA-90)', () => {
  it('none in tests unless asked for: no test reaches the network', () => {
    expect(breachCheckFor(env({ NODE_ENV: 'test' }))).toBeNull();
  });

  it('HIBP in development and production unless switched off', () => {
    expect(breachCheckFor(env({ NODE_ENV: 'production' }))).toBeTypeOf('function');
    expect(breachCheckFor(env({ NODE_ENV: 'development' }))).toBeTypeOf('function');
    expect(
      breachCheckFor(env({ NODE_ENV: 'production', PASSWORD_BREACH_CHECK: 'off' })),
    ).toBeNull();
  });
});
