import { cn } from '@/lib/utils';

/**
 * An on/off toggle (`role="switch"`), 34 × 20 with the knob sliding 150 ms; the
 * label is for screen readers, the row shows its own.
 */
export function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(12,59,60,0.2)] transition-transform duration-150 ease-out-soft',
          checked && 'translate-x-[14px]',
        )}
      />
    </button>
  );
}
