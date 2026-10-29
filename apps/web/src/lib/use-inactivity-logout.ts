import { WEB_IDLE_TIMEOUT_MS } from '@intra/shared/schemas';
import { useEffect, useRef, useState } from 'react';
import { keepSessionAlive } from './trpc';

const EVENTS = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'] as const;

/** How long before the idle logout the tab warns. */
export const IDLE_WARNING_MS = 2 * 60_000;

/**
 * The session is one for all tabs of the browser, so the hour is too. Each tab writes when
 * somebody last used it here, and a tab whose own hour is up first asks whether another one was
 * used meanwhile. Without it a forgotten tab would log out the one in use, mid-work.
 */
export const ACTIVITY_KEY = 'intra:last-activity';
/** A tab in use writes at most this often: `scroll` fires many times a second. */
const SHARE_EVERY_MS = 10_000;

// A time ahead of now (a clock set back since, a hand-edited value) or no number at all must not
// keep the tab signed in: both count as no other tab at all.
const readShared = () => {
  try {
    const at = Number(localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(at) && at <= Date.now() ? at : 0;
  } catch {
    return 0;
  }
};
const writeShared = (at: number) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Storage refused (private mode, quota): this tab then counts its own hour, as before.
  }
};

/**
 * The session ends after an hour without any interaction, in any tab of the browser. The timer
 * logs this tab out; the server holds the same hour for a tab that is gone, so every interaction
 * also keeps the server's side of the session alive (typing a long text sends no request of its
 * own), and a server that has already ended it (after sleep) ends the tab too. Two minutes before
 * the hour `onWarning(true)`; the next interaction, here or in another tab, withdraws it with
 * `onWarning(false)`. Returns the cleanup.
 *
 * No timeout parameter: the tab and the server read the same constant, so they cannot drift.
 */
export function watchInactivity(
  onTimeout: () => void,
  onWarning: (warning: boolean) => void = () => undefined,
) {
  let warned = false;
  let lastActivity = Date.now();
  let lastShared = 0;
  let timers: number[] = [];

  const idleFor = () => Date.now() - Math.max(lastActivity, readShared());
  const clear = () => timers.forEach((timer) => window.clearTimeout(timer));
  const schedule = () => {
    clear();
    const idle = idleFor();
    timers = [
      window.setTimeout(warn, Math.max(0, WEB_IDLE_TIMEOUT_MS - IDLE_WARNING_MS - idle)),
      window.setTimeout(expire, Math.max(0, WEB_IDLE_TIMEOUT_MS - idle)),
    ];
  };
  // Another tab may have been used since these were set: then the hour is counted from there.
  const warn = () => {
    if (idleFor() < WEB_IDLE_TIMEOUT_MS - IDLE_WARNING_MS) return schedule();
    warned = true;
    onWarning(true);
  };
  const expire = () => {
    if (idleFor() < WEB_IDLE_TIMEOUT_MS) return schedule();
    onTimeout();
  };
  const withdraw = () => {
    if (!warned) return;
    warned = false;
    onWarning(false);
  };

  const reset = () => {
    lastActivity = Date.now();
    if (lastActivity - lastShared >= SHARE_EVERY_MS) {
      lastShared = lastActivity;
      writeShared(lastActivity);
    }
    withdraw();
    schedule();
    keepSessionAlive(onTimeout);
  };
  // The tab in use keeps the server's session alive itself; this one only counts again.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ACTIVITY_KEY) return;
    withdraw();
    schedule();
  };

  schedule();
  for (const event of EVENTS) window.addEventListener(event, reset, { passive: true });
  window.addEventListener('storage', onStorage);
  return () => {
    clear();
    for (const event of EVENTS) window.removeEventListener(event, reset);
    window.removeEventListener('storage', onStorage);
  };
}

/** Returns whether the idle warning is due (the shell shows `IdleWarning`). */
export function useInactivityLogout(onTimeout: () => void): boolean {
  const [warning, setWarning] = useState(false);
  // One watcher for the shell's lifetime. Restarting it whenever `onTimeout` changed identity
  // (the warning itself re-renders the shell) forgot that it had warned, so no interaction could
  // withdraw the warning any more.
  const timeout = useRef(onTimeout);
  timeout.current = onTimeout;
  useEffect(() => watchInactivity(() => timeout.current(), setWarning), []);
  return warning;
}
