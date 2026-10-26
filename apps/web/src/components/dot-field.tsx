import { useEffect, useRef } from 'react';

/**
 * The login panel's dot grid, alive (ALMA-288 item 13). The grid itself stays the CSS background
 * of the panel (18 px, 1 px dots of the active icon's colour at 20 %); this canvas over it only
 * lights some of its dots:
 *
 * - a soft band of light crosses the grid about every 7 s while the mouse rests, and
 * - the dots near the cursor brighten and grow a little (a spotlight).
 *
 * Nothing loops for attention: between two waves, with the mouse still, nothing is drawn and no
 * frame is asked for. A hidden tab draws nothing. With `prefers-reduced-motion` the canvas is not
 * started at all and the grid is the static one.
 */

export const DOT_STEP = 18;
/** The spotlight's reach around the cursor. */
export const SPOT_RADIUS = 130;
/** The wave: how wide its band is, how long it takes to cross, how long the grid rests between. */
export const WAVE_WIDTH = 160;
export const WAVE_MS = 2600;
export const WAVE_EVERY_MS = 7000;
/** The mouse counts as resting this long after it last moved. */
const IDLE_MS = 1500;

/** How much a dot lights up (0 to 1) at `distance` from the cursor. */
export function spotlight(distance: number): number {
  if (distance >= SPOT_RADIUS) return 0;
  const t = 1 - distance / SPOT_RADIUS;
  return t * t;
}

/**
 * How much a dot lights up (0 to 1) as the wave passes: `front` is how far the band's centre has
 * travelled along the diagonal, `position` the dot's place along it.
 */
export function waveLight(position: number, front: number): number {
  const off = Math.abs(position - front);
  if (off >= WAVE_WIDTH / 2) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * off) / (WAVE_WIDTH / 2)));
}

export function DotField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = canvas?.parentElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !panel || !context) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let width = 0;
    let height = 0;
    let frame: number | null = null;
    let pointer: { x: number; y: number } | null = null;
    let lastMove = 0;
    let waveStart: number | null = null;
    let nextWave = performance.now() + WAVE_EVERY_MS / 2;
    let timer: number | null = null;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = panel.clientWidth;
      height = panel.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (now: number) => {
      frame = null;
      context.clearRect(0, 0, width, height);
      const idle = !pointer || now - lastMove > IDLE_MS;
      if (waveStart === null && idle && now >= nextWave) waveStart = now;
      const diagonal = width + height;
      const front =
        waveStart === null
          ? null
          : ((now - waveStart) / WAVE_MS) * (diagonal + WAVE_WIDTH) - WAVE_WIDTH / 2;
      if (front !== null && front > diagonal + WAVE_WIDTH / 2) {
        waveStart = null;
        nextWave = now + WAVE_EVERY_MS;
      }
      for (let y = DOT_STEP / 2; y < height; y += DOT_STEP) {
        for (let x = DOT_STEP / 2; x < width; x += DOT_STEP) {
          const spot = pointer ? spotlight(Math.hypot(x - pointer.x, y - pointer.y)) : 0;
          const wave = front === null ? 0 : waveLight(x + y, front) * 0.6;
          const light = Math.max(spot, wave);
          if (light <= 0.02) continue;
          context.beginPath();
          context.fillStyle = `rgba(95, 208, 201, ${(0.2 + 0.55 * light).toFixed(3)})`;
          context.arc(x, y, 1 + 0.9 * light, 0, Math.PI * 2);
          context.fill();
        }
      }
      // Frames only while a wave is under way; the spotlight is drawn again on each move of the
      // mouse and simply stays while it rests.
      if (waveStart !== null) schedule();
      else wait();
    };

    const schedule = () => {
      if (frame === null && document.visibilityState === 'visible') {
        frame = requestAnimationFrame(draw);
      }
    };
    // Between waves nothing is drawn: one timer wakes the field for the next one, not before the
    // mouse has rested.
    const wait = () => {
      if (timer !== null) window.clearTimeout(timer);
      const due = Math.max(nextWave, pointer ? lastMove + IDLE_MS : 0);
      timer = window.setTimeout(
        () => {
          timer = null;
          schedule();
        },
        Math.max(16, due - performance.now()),
      );
    };

    const onMove = (event: PointerEvent) => {
      const box = panel.getBoundingClientRect();
      pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
      lastMove = performance.now();
      schedule();
    };
    const onLeave = () => {
      pointer = null;
      schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule();
      else if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    };

    resize();
    const observer = new ResizeObserver(() => {
      resize();
      schedule();
    });
    observer.observe(panel);
    panel.addEventListener('pointermove', onMove);
    panel.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    wait();
    return () => {
      observer.disconnect();
      panel.removeEventListener('pointermove', onMove);
      panel.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className ?? 'pointer-events-none absolute inset-0 size-full'}
    />
  );
}
