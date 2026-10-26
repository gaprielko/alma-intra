import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, type ReactNode } from 'react';


const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** W18: an entrance, eased out, and the 6 px the page rises by. */
const FADE_MS = 200;
const RISE_PX = 6;

/**
 * The section of the sidebar a path belongs to: its first segment („/patients/…“ → „patients“).
 * A tab, a detail or a filter inside the section is not a new screen to fade in.
 */
export function sectionOf(pathname: string): string {
  return pathname.split('/').find(Boolean) ?? '';
}

/**
 * The page fades and rises in when the sidebar moves to another section (ALMA-353). The Web
 * Animations API on the one wrapper, so nothing remounts and nothing is left behind: once the
 * animation ends the wrapper has no transform. Nothing moves for who asked for less motion.
 */
export function RouteFade({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The resolved location: while the next screen loads, the router still shows the last one, and
  // fading that in would be a blink of the wrong page.
  const section = useRouterState({
    select: (s) => sectionOf((s.resolvedLocation ?? s.location).pathname),
  });
  const shown = useRef(section);
  useEffect(() => {
    if (shown.current === section) return;
    shown.current = section;
    const element = ref.current;
    if (!element || typeof element.animate !== 'function' || prefersReducedMotion()) return;
    element.animate(
      [
        { opacity: 0, transform: `translateY(${RISE_PX}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: FADE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, [section]);
  return <div ref={ref}>{children}</div>;
}
