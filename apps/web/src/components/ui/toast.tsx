import { sk } from '@intra/shared/i18n';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * What the app has to say about something that just happened. It rises at the bottom right, goes
 * away on its own and can be closed — it never takes a line of the page, so a screen does not jump
 * when a save succeeds or a drag is refused.
 *
 * The rule:
 * - Every mutation that succeeds says so: `toast('success', …)` with a concrete sentence that names
 *   the thing („Pozvánka odoslaná na {email}“, „Pacient pridelený“, „Licencia uložená“), not „OK“.
 * - A refusal that is not about one field is an error toast (`toast('error', errorMessage(e))`).
 *   A field error stays inline under its field, from Zod or `setError`.
 * - An outcome is never a green or red line or box on the page; what stays on the page is STATE,
 *   what the user must keep seeing while deciding (a care-plan check, „Indikácia končí o 9 dní“,
 *   a read-only banner, an address that was not located). Login, activation and password reset
 *   keep their inline error box: there is no app shell, and the message belongs to the form.
 *
 * Tones: `success` (green ✓) something was done; `error` (red ⚠) it was not; `warning` (amber !)
 * it was done, but something needs attention; `info` (blue i) something to know, nothing went
 * wrong. Error and warning are read out at once (`role="alert"`) and stay longer.
 *
 * The look: 320–400 wide on Elevation/3, rounded 12, the icon in a 26 px
 * soft circle, a 2 px accent line running out along the bottom as the time runs out (it pauses
 * while the pointer is over it), the newest on top of a stack of three at most, the older ones a
 * little smaller and paler behind it. In 200 ms from below, out in a 150 ms fade.
 */
export type ToastTone = 'success' | 'error' | 'warning' | 'info';

/**
 * Something the message lets you do about what just happened — „Vrátiť späť“ after a substitution
 *. It lives as long as the toast does: an undo nobody can reach is not an undo.
 */
export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
  action?: ToastAction;
  /** Set while the exit fade runs; the row is gone once it ends. */
  leaving?: boolean;
}

/**
 * Long enough to read a sentence, short enough not to sit in the way. An error stays longer, and
 * one that offers an undo stays longest — deciding takes more than reading.
 */
const LIFETIME: Record<ToastTone, number> = {
  success: 5000,
  info: 5000,
  warning: 9000,
  error: 9000,
};
const WITH_ACTION = 12000;
/** W14: the newest three; an older one goes when a fourth arrives. */
const STACK_MAX = 3;
const EXIT_MS = 150;

/** How long a toast stays, in ms. */
export function toastLifetime(tone: ToastTone, withAction: boolean): number {
  return withAction ? WITH_ACTION : LIFETIME[tone];
}

/** Error and warning interrupt a screen reader; success and info wait their turn. */
export function toastRole(tone: ToastTone): 'alert' | 'status' {
  return tone === 'error' || tone === 'warning' ? 'alert' : 'status';
}

/**
 * Which of the toasts the provider must close because the stack is full: the oldest living ones
 * beyond `STACK_MAX`. They stay drawn until their fade is over, so an evicted toast is seen going.
 */
export function evictedToasts<T extends { leaving?: boolean }>(
  toasts: readonly T[],
  max = STACK_MAX,
): T[] {
  const live = toasts.filter((toast) => !toast.leaving);
  return live.slice(0, Math.max(0, live.length - max));
}

/** How far back from the top a toast sits: 0 for the newest living one, counting the living only. */
export function stackDepth<T extends { leaving?: boolean }>(
  toasts: readonly T[],
  toast: T,
): number {
  const live = toasts.filter((one) => !one.leaving);
  const index = live.indexOf(toast);
  return index < 0 ? 0 : live.length - 1 - index;
}

/** The icon in its soft circle; the text stays in `foreground`. */
const LOOK: Record<ToastTone, { circle: string; Icon: LucideIcon }> = {
  success: { circle: 'bg-success-soft text-success', Icon: CircleCheck },
  error: { circle: 'bg-danger-soft text-danger', Icon: TriangleAlert },
  warning: { circle: 'bg-warning-soft text-warning', Icon: CircleAlert },
  info: { circle: 'bg-info-soft text-info', Icon: Info },
};

const ToastContext = createContext<
  ((tone: ToastTone, text: string, action?: ToastAction) => void) | null
>(null);

/** Set by the mounted provider; lets `clearToasts` reach it from outside React. */
let clearMounted: (() => void) | null = null;

/**
 * Drops every toast and its timer. On logout (`endSession`): the provider lives at the root now,
 * so without this a message about the previous user's work would still sit on the login page.
 */
export function clearToasts() {
  clearMounted?.();
}

/**
 * The toast of the provider above, or `null` without one: for the shared fields (`NumberField`,
 * `DatePicker`, `TimePicker`), which also render alone in tests.
 */
export const useToastIfProvided = () => useContext(ToastContext);

/** `toast('success', 'Presunuté: …')` from anywhere under the provider. */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast needs a ToastProvider above it');
  return show;
}

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  /** What is left of the lifetime once the pointer leaves. */
  remaining: number;
  startedAt: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, Timer>());
  const exits = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    const exit = exits.current.get(id);
    if (exit) clearTimeout(exit);
    exits.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /** Starts the fade; the row leaves the list when it has faded. */
  const close = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (timer?.handle) clearTimeout(timer.handle);
      timers.current.delete(id);
      if (exits.current.has(id)) return;
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      );
      exits.current.set(
        id,
        setTimeout(() => remove(id), EXIT_MS),
      );
    },
    [remove],
  );

  const start = useCallback(
    (id: number, ms: number) => {
      const timer = timers.current.get(id);
      if (!timer) return;
      if (timer.handle) clearTimeout(timer.handle);
      timer.remaining = ms;
      timer.startedAt = Date.now();
      timer.handle = setTimeout(() => close(id), ms);
    },
    [close],
  );

  /** The pointer is over the toast: the clock stops. */
  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer?.handle) return;
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }, []);

  const resume = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (!timer || timer.handle) return;
      start(id, timer.remaining);
    },
    [start],
  );

  const show = useCallback(
    (tone: ToastTone, text: string, action?: ToastAction) => {
      const id = (next.current += 1);
      const lifetime = toastLifetime(tone, Boolean(action));
      // The same sentence twice in a row is one message, not two stacked on each other.
      setToasts((current) => [
        ...current.filter((toast) => toast.text !== text),
        { id, tone, text, ...(action ? { action } : {}) },
      ]);
      timers.current.set(id, { handle: null, remaining: lifetime, startedAt: Date.now() });
      start(id, lifetime);
    },
    [start],
  );

  // A fourth toast pushes the oldest out at once, with its fade.
  useEffect(() => {
    for (const toast of evictedToasts(toasts)) close(toast.id);
  }, [toasts, close]);

  useEffect(() => {
    const running = timers.current;
    const leaving = exits.current;
    const clear = () => {
      for (const timer of running.values()) if (timer.handle) clearTimeout(timer.handle);
      running.clear();
      for (const exit of leaving.values()) clearTimeout(exit);
      leaving.clear();
      setToasts([]);
    };
    clearMounted = clear;
    return () => {
      for (const timer of running.values()) if (timer.handle) clearTimeout(timer.handle);
      running.clear();
      for (const exit of leaving.values()) clearTimeout(exit);
      leaving.clear();
      if (clearMounted === clear) clearMounted = null;
    };
  }, []);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // A live region that is always in the tree: a screen reader reads what appears in it.
        // `data-toast`: a click here is not a click outside an open dialog (ui/dialog.tsx).
        data-toast
        aria-live="polite"
        className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-[min(25rem,calc(100vw-3rem))] flex-col items-end gap-2"
      >
        {toasts.map((toast) => {
          const { circle, Icon } = LOOK[toast.tone];
          // 0 is the newest, on top; the ones behind it step back; one fading out stays put.
          const depth = stackDepth(toasts, toast);
          const lifetime = toastLifetime(toast.tone, Boolean(toast.action));
          return (
            <div
              key={toast.id}
              role={toastRole(toast.tone)}
              // On the card too: Radix may judge the click after the toast is gone from the
              // region (it closes on that click), and a detached card has no region above it.
              data-toast
              data-tone={toast.tone}
              onMouseEnter={() => pause(toast.id)}
              onMouseLeave={() => resume(toast.id)}
              // The keyboard too: a toast with focus on its button waits.
              onFocus={() => pause(toast.id)}
              onBlur={() => resume(toast.id)}
              style={{
                transform: `translateY(${depth * 8}px) scale(${1 - depth * 0.04})`,
                opacity: toast.leaving ? 0 : depth === 0 ? 1 : 0.75,
                transformOrigin: 'bottom center',
              }}
              className={cn(
                'group pointer-events-auto relative flex w-full min-w-80 items-start gap-3 overflow-hidden rounded-xl bg-white px-4 py-3 pb-3.5 text-sm text-foreground shadow-floating transition-[transform,opacity] duration-150 ease-out-soft focus-within:[&_.toast-progress]:[animation-play-state:paused]',
                'motion-safe:animate-toast-in',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'inline-flex size-[26px] shrink-0 items-center justify-center rounded-full',
                  circle,
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 pt-0.5 font-semibold">{toast.text}</span>
              {toast.action ? (
                <button
                  type="button"
                  onClick={() => {
                    close(toast.id);
                    void toast.action?.run();
                  }}
                  className="shrink-0 pt-0.5 text-xs font-medium text-primary-text hover:underline"
                >
                  {toast.action.label}
                </button>
              ) : null}
              <button
                type="button"
                aria-label={sk.common.close}
                onClick={() => close(toast.id)}
                className="-m-1 shrink-0 rounded p-1 text-tertiary hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
              {/* The time left, as a line that shortens; it stands still with the pointer over. */}
              <span
                aria-hidden
                className="toast-progress absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary motion-safe:animate-[toast-progress_linear_forwards] motion-reduce:hidden group-hover:[animation-play-state:paused]"
                style={{ animationDuration: `${lifetime}ms` }}
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
