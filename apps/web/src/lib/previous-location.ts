import type { AnyRouter } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';

/**
 * The screens the user went through inside the app, so a screen reached from elsewhere than its own
 * list can offer „Späť“ there. One entry per path, the latest filters of it kept; forms (`/new`,
 * `/edit`) are left out, so after saving one „Späť“ leads past it, not into it again.
 */
export interface VisitedLocation {
  pathname: string;
  href: string;
}

const LIMIT = 30;
const FORM = /\/(new|edit)$/;

let trail: VisitedLocation[] = [];
/** The title each screen showed, so „Späť na …“ can name it. */
const titles = new Map<string, string>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function trackPreviousLocation(router: AnyRouter) {
  return router.subscribe('onResolved', ({ toLocation }) => {
    const { pathname, href } = toLocation;
    if (FORM.test(pathname)) return;
    const last = trail.at(-1);
    trail =
      last?.pathname === pathname
        ? [...trail.slice(0, -1), { pathname, href }]
        : [...trail, { pathname, href }].slice(-LIMIT);
    emit();
  });
}

/** The header of the screen at `pathname` tells its title. */
export function nameLocation(pathname: string, title: string) {
  titles.set(pathname, title);
}

/** The title the screen at `pathname` showed, if it had a header. */
export function titleOf(pathname: string): string | null {
  return titles.get(pathname) ?? null;
}

/** Going back to `to` forgets what came after it, so the next „Späť“ leads further back. */
export function forgetAfter(to: VisitedLocation) {
  const index = trail.lastIndexOf(to);
  if (index >= 0) trail = trail.slice(0, index + 1);
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The last screen before the one at `pathname`, or null on the first screen of a visit. */
export function usePreviousLocation(pathname: string): VisitedLocation | null {
  const visited = useSyncExternalStore(
    subscribe,
    () => trail,
    () => trail,
  );
  for (let i = visited.length - 1; i >= 0; i--) {
    if (visited[i]!.pathname !== pathname) return visited[i]!;
  }
  return null;
}
