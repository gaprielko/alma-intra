const KEY = 'intra-share-return';

/**
 * A public link's token while its colleague signs in: in this tab's storage and never in an address,
 * as a token stays out of what a server or a referrer sees (CLAUDE.md, rule 5).
 */
export function rememberShareLink(token: string) {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // A blocked storage only means landing on the overview after signing in.
  }
}

/** The address to return to, once. */
export function takeShareLink(): string | null {
  try {
    const token = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? `/zdielanie#${token}` : null;
  } catch {
    return null;
  }
}
