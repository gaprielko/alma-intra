import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * The field of the web (ALMA-268, Figma W7, variant A): 56 px tall when its label sits inside it
 * (styles.css `field-inside`, which the wrapper draws by itself), rounded 12, a 1.5 px accent
 * border with a 3 px glow on focus, the danger border on an error, bg/subtle when disabled. No
 * microphone and no hint text on the web. Shared with the fields that look like an input:
 * `Select`, `DatePicker`, `TimePicker`, `Combobox`.
 *
 * Read-only (`readOnly`, ALMA-285 item 3) is the one look of a value a form shows but does not
 * change (the login e-mail, an accepted nurse's name, the insurance number, the nurse being
 * replaced, the patient of a planned visit): the same field, label inside, on bg/surface with the
 * value in the text colour, so it reads as information rather than as a field to fill. It is left
 * out of the tab order, and its text can still be selected and copied. Disabled (bg/subtle, the value in tertiary) is for
 * a field that is switched off for the moment. `readOnlyFieldClass` is the same look for
 * something that is not an `<input>` (`ComboboxChip`).
 */
export const inputClass =
  'h-12 w-full rounded-xl border border-border bg-white px-3 text-[15px] text-foreground transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-tertiary focus:border-primary focus:shadow-[0_0_0_3px_rgba(15,139,141,0.18)] aria-invalid:border-danger aria-invalid:focus:shadow-[0_0_0_3px_rgba(220,38,38,0.16)] disabled:bg-subtle disabled:text-tertiary [&[readonly]]:bg-surface';

export const readOnlyFieldClass = 'border-border bg-surface text-foreground';

/**
 * `suffix`: a unit at the right end of the field („min“, „€/km“), kept on the value's line whether
 * the label is inside or above (ALMA-285 item 2). The input then sits in a wrapper that carries
 * `data-input`, so the label rules of styles.css still find it; every prop goes to the input.
 */
export function Input({
  className,
  type,
  suffix,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { suffix?: ReactNode }) {
  if (suffix === undefined || suffix === null) {
    return <input type={type} data-input className={cn(inputClass, className)} {...props} />;
  }
  return (
    <div data-input className="relative w-full">
      <input type={type} className={cn(inputClass, 'pr-16', className)} {...props} />
      <span
        data-trailing
        className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted"
      >
        {suffix}
      </span>
    </div>
  );
}

/** The same field for a few lines of text; it grows with `rows`, never below two lines. */
export const textareaClass =
  'min-h-20 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[15px] leading-6 text-foreground transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-tertiary focus:border-primary focus:shadow-[0_0_0_3px_rgba(15,139,141,0.18)] aria-invalid:border-danger disabled:bg-subtle disabled:text-tertiary';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-input className={cn(textareaClass, className)} {...props} />;
}
