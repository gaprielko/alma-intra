import { sk } from '@intra/shared/i18n';
import { type Gender, suggestSalutation } from '@intra/shared/schemas';
import { Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { SegmentedChoice } from '@/components/ui/segmented';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/phone-input';

const d = sk.contacts.dialog;

/** The form values of a person: a contact, or a private-person customer. */
export interface PersonValues {
  titleBefore: string;
  firstName: string;
  lastName: string;
  titleAfter: string;
  gender: '' | Gender;
  salutation: string;
  email: string;
  phone: string;
  position?: string;
}

export const emptyPerson = (): PersonValues => ({
  titleBefore: '',
  firstName: '',
  lastName: '',
  titleAfter: '',
  gender: '',
  salutation: '',
  email: '',
  phone: '',
  position: '',
});

function TextField({
  name,
  label,
  type = 'text',
  autoComplete = 'off',
  description,
  className,
  locked = false,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  description?: string;
  className?: string;
  /** It follows the user: shown, not edited. */
  locked?: boolean;
}) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {locked ? <Lock className="ml-1 inline size-3 text-tertiary" aria-hidden /> : null}
          </FormLabel>
          <FormControl>
            {type === 'tel' ? (
              <PhoneInput
                autoComplete={autoComplete}
                {...field}
                disabled={locked}
                value={(field.value as string) ?? ''}
              />
            ) : (
              <Input
                type={type}
                autoComplete={autoComplete}
                {...field}
                disabled={locked}
                value={(field.value as string) ?? ''}
              />
            )}
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * Titles, name, position, „pán / pani“, e-mail, phone and the salutation, under `prefix` in the
 * surrounding form. The salutation follows the position, the name and the „pán / pani“ choice
 * until somebody writes their own.
 */
export function PersonFields({
  prefix,
  withPosition = true,
  showPreview = false,
  followsUser = false,
}: {
  prefix: string;
  withPosition?: boolean;
  showPreview?: boolean;
  /** A contact made from a user: the titles, name, e-mail and phone are theirs (D-47). */
  followsUser?: boolean;
}) {
  const { control, getValues, setValue } = useFormContext();
  const at = (field: string) => `${prefix}.${field}`;
  const [gender, lastName, position, salutation] = useWatch({
    control,
    name: [at('gender'), at('lastName'), at('position'), at('salutation')],
  }) as [string, string, string | undefined, string];
  const suggested = useRef(
    suggestSalutation({ gender: (gender || undefined) as Gender | undefined, lastName, position }),
  );

  useEffect(() => {
    const next = suggestSalutation({
      gender: (gender || undefined) as Gender | undefined,
      lastName,
      position: withPosition ? position : undefined,
    });
    const current = (getValues(at('salutation')) as string) ?? '';
    // Only a salutation nobody has written themselves follows the other fields.
    if (current === '' || current === suggested.current) {
      setValue(at('salutation'), next, { shouldDirty: current !== next });
    }
    suggested.current = next;
    // `at` is derived from `prefix`, which never changes for a mounted form.
  }, [gender, lastName, position, withPosition]);

  return (
    <div className="grid gap-4 @md:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,7rem)]">
      <TextField name={at('titleBefore')} label={d.titleBefore} locked={followsUser} />
      <TextField
        name={at('firstName')}
        label={d.firstName}
        autoComplete="given-name"
        locked={followsUser}
      />
      <TextField
        name={at('lastName')}
        label={d.lastName}
        autoComplete="family-name"
        locked={followsUser}
      />
      <TextField name={at('titleAfter')} label={d.titleAfter} locked={followsUser} />
      {withPosition ? (
        <TextField name={at('position')} label={d.position} className="@md:col-span-2" />
      ) : null}
      <FormField
        control={control}
        name={at('gender')}
        render={({ field }) => (
          <FormItem className={withPosition ? '@md:col-span-2' : '@md:col-span-4'}>
            <FormLabel>{d.gender}</FormLabel>
            <div>
              <SegmentedChoice
                label={d.gender}
                value={(field.value as string) || ''}
                onChange={(value) => field.onChange(value)}
                options={[
                  { key: 'male', label: d.male },
                  { key: 'female', label: d.female },
                ]}
              />
            </div>
          </FormItem>
        )}
      />
      <TextField
        name={at('email')}
        label={d.email}
        type="email"
        className="@md:col-span-2"
        locked={followsUser}
      />
      <TextField
        name={at('phone')}
        label={d.phone}
        type="tel"
        className="@md:col-span-2"
        locked={followsUser}
      />
      <TextField
        name={at('salutation')}
        label={d.salutation}
        description={d.salutationHint}
        className="@md:col-span-4"
      />
      {showPreview && salutation ? (
        <p className="-mt-2 rounded-xl bg-surface px-4 py-3 text-sm text-muted @md:col-span-4">
          {d.preview(salutation)}
        </p>
      ) : null}
    </div>
  );
}

export { TextField };
