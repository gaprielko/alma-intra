import { sk } from '@intra/shared/i18n';
import { formatPhone } from '@intra/shared/schemas';
import { type ComponentProps, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';

/** The countries the picker offers, Slovakia first; a number from elsewhere is typed with its +code. */
const COUNTRIES = [
  ['SK', '421'],
  ['CZ', '420'],
  ['AT', '43'],
  ['HU', '36'],
  ['PL', '48'],
  ['UA', '380'],
  ['DE', '49'],
  ['GB', '44'],
] as const;
type Country = (typeof COUNTRIES)[number][0];

/** The country of a stored number and the rest of it; Slovakia for an empty one. */
function split(value: string): { country: Country; national: string } {
  const found = [...COUNTRIES]
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, code]) => value.startsWith(`+${code}`));
  if (!found) return { country: 'SK', national: value };
  return { country: found[0], national: value.slice(found[1].length + 1).trim() };
}

const codeOf = (country: Country) => COUNTRIES.find(([key]) => key === country)![1];

/**
 * A phone field: the country (Slovakia, +421, unless chosen otherwise) and the number, kept as the
 * app stores it, `+421 9xx xxx xxx`. Spaces appear while digits are typed; deleting is left alone.
 * A number typed with its own +code or 00 wins over the picker. No sample number is shown.
 */
export function PhoneInput({
  value,
  onChange,
  onBlur,
  id,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const parsed = split(value);
  const [country, setCountry] = useState<Country>(parsed.country);
  const national = value ? parsed.national : '';
  const compose = (typed: string, pick: Country = country) => {
    const trimmed = typed.trim();
    if (!trimmed) return '';
    // Typed with its own country code: that number as it is.
    if (trimmed.startsWith('+') || trimmed.startsWith('00')) return formatPhone(trimmed);
    // The domestic leading 0 („0905…“) is dropped after a country code.
    return formatPhone(`+${codeOf(pick)} ${trimmed.replace(/^0+/, '')}`);
  };
  return (
    <div className="flex gap-2">
      <Select
        aria-label={sk.common.phoneCountry}
        value={value ? parsed.country : country}
        onChange={(next) => {
          const pick = next as Country;
          setCountry(pick);
          if (national) onChange(compose(national, pick));
        }}
        className="w-[7.5rem] shrink-0"
      >
        {COUNTRIES.map(([key, code]) => (
          <SelectItem key={key} value={key}>
            {`${key} +${code}`}
          </SelectItem>
        ))}
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        {...props}
        value={national}
        onChange={(event) => {
          const next = event.target.value;
          if (next.length > national.length) onChange(compose(next));
          // Deleting keeps what is left as it is, so a space can be removed.
          else onChange(next.trim() ? `+${codeOf(value ? parsed.country : country)} ${next}` : '');
        }}
        onBlur={(event) => {
          onChange(compose(event.target.value));
          onBlur?.(event);
        }}
      />
    </div>
  );
}
