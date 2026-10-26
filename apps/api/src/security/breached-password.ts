import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { describeError } from '../logging/describe-error.js';

/**
 * Have I Been Pwned's range API (ALMA-90, ADR-003 amendment): a new password is refused when it
 * appears in a known breach. k-anonymity: only the first 5 hex characters of the password's SHA-1
 * leave the server; the answer lists every suffix of that range (several hundred), and the match
 * is made here. The password, its hash and the prefix are never logged.
 */
export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/** A login page waits for this at most; HIBP answers in well under a second from the CDN. */
export const BREACH_CHECK_TIMEOUT_MS = 2_500;

/** `true` when the password is known from a breach. Never throws: an unreachable HIBP is `false`. */
export type BreachCheck = (password: string) => Promise<boolean>;

/** The SHA-1 of the password in upper-case hex, split where HIBP splits it: 5 + 35 characters. */
export function sha1Range(password: string): { prefix: string; suffix: string } {
  const hex = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
}

/**
 * Whether a range answer (`SUFFIX:COUNT` per line) lists the suffix. A count of 0 is padding
 * (`Add-Padding: true` hides the real size of the answer), not a breach.
 */
export function rangeLists(body: string, suffix: string): boolean {
  for (const line of body.split('\n')) {
    const [candidate, count] = line.trim().split(':');
    if (candidate?.toUpperCase() === suffix && Number(count) > 0) return true;
  }
  return false;
}

interface Options {
  /** Injected in tests: no test ever calls the real API. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: Pick<Logger, 'warn'>;
}

/**
 * **Fail-open** (decided in ALMA-90): a timeout, a network error or an answer other than 200 lets
 * the password through and logs a warning with the error's names only. The breach list is a
 * second line behind the length rule; an HIBP outage must not stop a nurse from setting her
 * password, and it must never make our API unavailable.
 */
export function hibpBreachCheck(options: Options = {}): BreachCheck {
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? BREACH_CHECK_TIMEOUT_MS;
  const logger = options.logger ?? new Logger('breached-password');
  return async (password) => {
    const { prefix, suffix } = sha1Range(password);
    try {
      const response = await fetchFn(HIBP_RANGE_URL + prefix, {
        headers: { 'add-padding': 'true', 'user-agent': 'alma-intra' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        logger.warn({ msg: 'password breach check skipped', status: response.status });
        return false;
      }
      return rangeLists(await response.text(), suffix);
    } catch (error) {
      // Names only (`TimeoutError`, `TypeError`): a message could carry the URL, and with it the prefix.
      logger.warn({ msg: 'password breach check skipped', ...describeError(error) });
      return false;
    }
  };
}
