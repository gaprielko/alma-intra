import { useEffect, useState } from 'react';

/**
 * A one-time token (invitation, password reset) arrives in the URL fragment, which browsers never
 * send to a server. It is read once and removed from the address bar, so it does not linger in
 * history or screenshots; from here on it travels in POST bodies only.
 */
export function useFragmentToken() {
  // Tokens are URL-safe, so the fragment is used as it is; decoding could only throw.
  const [token] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return token;
}
