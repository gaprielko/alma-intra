import { Global, Module } from '@nestjs/common';
import { type Env, loadEnv } from '../config/env.js';
import { type BreachCheck, hibpBreachCheck } from './breached-password.js';

export const BREACH_CHECK = Symbol('BREACH_CHECK');

/** `hibp` unless configured `off`; tests default to `off` so that none of them reaches the network. */
export function breachCheckFor(env: Env): BreachCheck | null {
  const choice = env.PASSWORD_BREACH_CHECK ?? (env.NODE_ENV === 'test' ? 'off' : 'hibp');
  return choice === 'hibp' ? hibpBreachCheck() : null;
}

/**
 * The breached-password check of the tRPC context (ALMA-90); `null` when switched off. Tests
 * override the provider with `hibpBreachCheck({ fetch })` and a stubbed answer.
 */
@Global()
@Module({
  providers: [{ provide: BREACH_CHECK, useFactory: () => breachCheckFor(loadEnv()) }],
  exports: [BREACH_CHECK],
})
export class BreachCheckModule {}
