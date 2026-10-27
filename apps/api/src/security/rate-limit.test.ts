import { describe, expect, it } from 'vitest';
import { ipSubject } from './rate-limit.js';

describe('ipSubject', () => {
  it('keeps an IPv4 address and unwraps an IPv4-mapped one', () => {
    expect(ipSubject('203.0.113.7')).toBe('203.0.113.7');
    expect(ipSubject('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('collapses every address of an IPv6 /64 into one subject', () => {
    const subjects = [
      '2001:db8:12:3400::1',
      '2001:0db8:0012:3400:ffff:ffff:ffff:ffff',
      '2001:db8:12:3400:1::',
    ].map(ipSubject);
    expect(new Set(subjects)).toEqual(new Set(['2001:db8:12:3400::/64']));
    expect(ipSubject('2001:db8:12:3401::1')).not.toBe(subjects[0]);
  });

  it('treats every spelling of an IPv4-mapped address as that IPv4 client', () => {
    for (const ip of ['::ffff:cb00:7107', '0:0:0:0:0:ffff:203.0.113.7', '::FFFF:203.0.113.7']) {
      expect(ipSubject(ip)).toBe('203.0.113.7');
    }
  });

  it('ignores a zone id and leaves anything that is not an address alone', () => {
    expect(ipSubject('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipSubject('garbage')).toBe('garbage');
  });

  it('handles loopback and a missing address', () => {
    expect(ipSubject('::1')).toBe('0:0:0:0::/64');
    expect(ipSubject(undefined)).toBe('unknown');
  });
});
