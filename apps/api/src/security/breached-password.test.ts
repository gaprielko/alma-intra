import { describe, expect, it, vi } from 'vitest';
import {
  BREACH_CHECK_TIMEOUT_MS,
  HIBP_RANGE_URL,
  hibpBreachCheck,
  rangeLists,
  sha1Range,
} from './breached-password.js';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8, the example HIBP documents.
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

const answer = (body: string, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));

describe('the breached-password check', () => {
  it('splits the SHA-1 into the 5 characters that are sent and the 35 that are not', () => {
    expect(sha1Range('password')).toEqual({ prefix: PREFIX, suffix: SUFFIX });
    // Upper-case hex whatever the input, UTF-8 for anything beyond ASCII.
    const { prefix, suffix } = sha1Range('Žltý-kôň-2026');
    expect(prefix).toMatch(/^[0-9A-F]{5}$/);
    expect(suffix).toMatch(/^[0-9A-F]{35}$/);
  });

  it('finds the suffix in a range answer, ignoring case, CRLF and padding with count 0', () => {
    const body = `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX.toLowerCase()}:3861493\r\n`;
    expect(rangeLists(body, SUFFIX)).toBe(true);
    expect(rangeLists('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n', SUFFIX)).toBe(false);
    expect(rangeLists(`${SUFFIX}:0\r\n`, SUFFIX)).toBe(false);
    expect(rangeLists('', SUFFIX)).toBe(false);
  });

  it('sends only the prefix, with padding asked for and a timeout', async () => {
    const fetch = answer(`${SUFFIX}:10\r\n`);
    expect(await hibpBreachCheck({ fetch })('password')).toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${HIBP_RANGE_URL}${PREFIX}`);
    expect(url as string).not.toContain(SUFFIX);
    expect(init?.headers).toMatchObject({ 'add-padding': 'true' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(init)).not.toContain('password');
    expect(BREACH_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
  });

  it('lets a password through that the range does not list', async () => {
    expect(await hibpBreachCheck({ fetch: answer('00000:1\r\n') })('password')).toBe(false);
  });

  it('fails open on a network error, a timeout or a bad status, and logs no secret', async () => {
    const warn = vi.fn();
    const failing = [
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError(`fetch failed ${PREFIX}`)),
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException(`${HIBP_RANGE_URL}${PREFIX}`, 'TimeoutError')),
      answer('Service Unavailable', 503),
    ];
    for (const fetch of failing) {
      expect(await hibpBreachCheck({ fetch, logger: { warn } })('password')).toBe(false);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(warn.mock.calls);
    // „password“ is the log line's own word; the typed value is tried with one it cannot contain.
    for (const secret of [PREFIX, SUFFIX, HIBP_RANGE_URL]) {
      expect(logged).not.toContain(secret);
    }
    const typed = 'Tajne-heslo-2026';
    const range = sha1Range(typed);
    const again = vi.fn();
    await hibpBreachCheck({ fetch: failing[0]!, logger: { warn: again } })(typed);
    for (const secret of [typed, range.prefix, range.suffix]) {
      expect(JSON.stringify(again.mock.calls)).not.toContain(secret);
    }
    expect(logged).toContain('TimeoutError');
    expect(logged).toContain('503');
  });

  it('gives up after its timeout instead of holding the request', async () => {
    // A server that never answers: only the abort signal ends the wait.
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason as Error));
        }),
    );
    const started = Date.now();
    const check = hibpBreachCheck({ fetch: hanging, timeoutMs: 50, logger: { warn: vi.fn() } });
    expect(await check('password')).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
