import { Check, Minus } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, type ComponentProps, type Ref } from 'react';
import { cn } from '@/lib/utils';

type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** „Some of them“: a select-all box over a partly ticked list. Only drawn, never submitted. */
  indeterminate?: boolean;
};

/**
 * The Figma `Checkbox` (ALMA-170, item 12; ALMA-268 W18): 18×18, rounded 5, `border` when off,
 * `primary` fill and a white tick drawn in 150 ms when on, pale when disabled. It is still the native `<input type="checkbox">`, only
 * drawn by us (`appearance-none` + an icon over it), so `{...form.register('x')}`, `checked` +
 * `onChange`, `getByRole('checkbox')`, Space and the label click all work as with the browser's.
 *
 * `className` goes on the wrapper (placement: `mt-0.5`, …); every other prop, `ref` included, goes
 * on the input. Put it inside a `<label>` with its text, or give it an `aria-label`.
 *
 * The box always has an id, and a `<label>` around it without `htmlFor` is pointed at it
 * (`pointLabelAt`): a label that only wraps its checkbox names it for the browser, but not for
 * every tool that reads the page, which heard „on“ (the value) instead (ALMA-285 item 9). A disabled box keeps a visible
 * outline; `title` (why it cannot be ticked) shows over the whole box (ALMA-285 item 21).
 */
export function Checkbox({
  className,
  indeterminate = false,
  ref,
  id,
  title,
  ...props
}: CheckboxProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const ownId = useId();
  const inputId = id ?? ownId;
  // `indeterminate` is a DOM property, not an attribute: React cannot set it from JSX.
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  useEffect(() => pointLabelAt(input.current, inputId), [inputId]);
  const setRef = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element;
      assignRef(ref, element);
    },
    [ref],
  );
  return (
    <span
      title={title}
      className={cn('relative inline-grid size-[18px] shrink-0 place-items-center', className)}
    >
      <input
        type="checkbox"
        ref={setRef}
        id={inputId}
        title={title}
        className={cn(
          'peer col-start-1 row-start-1 size-[18px] appearance-none rounded-[5px] border border-border bg-white transition-colors duration-150 outline-none',
          'hover:border-primary',
          'checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary',
          'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25',
          // Pale, but still a box: the outline in tertiary, so a row that cannot be ticked shows
          // that it cannot rather than seeming to have no box at all.
          'disabled:border-tertiary/60 disabled:bg-surface disabled:hover:border-tertiary/60',
          'disabled:checked:border-transparent disabled:checked:bg-primary/35 disabled:indeterminate:border-transparent disabled:indeterminate:bg-primary/35',
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none col-start-1 row-start-1 hidden size-3 text-white peer-checked:block peer-indeterminate:hidden [&>path]:[stroke-dasharray:24] motion-safe:peer-checked:[&>path]:animate-check-draw"
      />
      <Minus
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none col-start-1 row-start-1 hidden size-3 text-white peer-indeterminate:block"
      />
    </span>
  );
}

/**
 * Points the `<label>` around a checkbox at it, when the label names nothing itself; answers how
 * to undo it. The undo runs before a new box (another key, another id) points the label again and
 * when the box goes: a `for` left pointing at an id that is gone would label nothing at all, not
 * even the box the label still wraps. A `for` the author wrote is never touched.
 */
export function pointLabelAt(
  box: Pick<HTMLElement, 'closest'> | null,
  id: string,
): (() => void) | undefined {
  const label = box?.closest('label');
  if (!label || label.htmlFor) return undefined;
  label.htmlFor = id;
  return () => {
    if (label.htmlFor === id) label.removeAttribute('for');
  };
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
