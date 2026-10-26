/** Second-level domains reserved for documentation (RFC 2606, section 3), with every subdomain. */
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
/** Top-level names reserved for testing and examples (RFC 2606, section 2; RFC 6761). */
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost'];

/**
 * An address no mail can reach (ALMA-212): `@example.com` and its siblings, and anything under a
 * reserved top-level name. The seeds and the demo use them on purpose, so a provider asked to
 * deliver there only fails eight times and reports it. Case and a trailing root dot do not
 * matter; `notexample.com` is somebody's real domain and is not reserved.
 */
export function isReservedAddress(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at < 0) return false;
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return (
    RESERVED_TLDS.includes(tld) ||
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))
  );
}
