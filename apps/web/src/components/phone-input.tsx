import { formatPhone } from '@intra/shared/schemas';
import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';

/**
 * A phone field that writes the number as the app keeps it, `+421 911 115 502`: the spaces appear
 * while digits are typed, the whole number is shaped when the field is left. Deleting is left
 * alone, so a space can be removed without coming straight back.
 */
export function PhoneInput({
  value,
  onChange,
  onBlur,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      placeholder="+421 911 115 502"
      {...props}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next.length > value.length ? formatPhone(next) : next);
      }}
      onBlur={(event) => {
        onChange(formatPhone(event.target.value));
        onBlur?.(event);
      }}
    />
  );
}
