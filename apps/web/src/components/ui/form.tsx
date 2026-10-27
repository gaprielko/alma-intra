import type * as LabelPrimitive from '@radix-ui/react-label';
import { Slot } from '@radix-ui/react-slot';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type HTMLAttributes,
} from 'react';
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { validationMessage } from '@/lib/form-errors';
import { cn } from '@/lib/utils';

/** shadcn/ui form primitives over React Hook Form: `FormField` > `FormItem` > label, control, message. */
export const Form = FormProvider;

const FormFieldContext = createContext<{ name: string } | null>(null);
const FormItemContext = createContext<{
  id: string;
  hasDescription: boolean;
  setHasDescription: (value: boolean) => void;
} | null>(null);

export function FormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TTransformedValues = TFieldValues,
>(props: ControllerProps<TFieldValues, TName, TTransformedValues>) {
  const value = useMemo(() => ({ name: props.name }), [props.name]);
  return (
    <FormFieldContext.Provider value={value}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

function useFormField() {
  const field = useContext(FormFieldContext);
  const item = useContext(FormItemContext);
  if (!field || !item)
    throw new Error('useFormField must be used inside <FormField> and <FormItem>');
  const { getFieldState, getValues } = useFormContext();
  const formState = useFormState({ name: field.name });
  const { error } = getFieldState(field.name, formState);
  const value: unknown = getValues(field.name);
  return {
    controlId: `${item.id}-control`,
    descriptionId: `${item.id}-description`,
    messageId: `${item.id}-message`,
    hasDescription: item.hasDescription,
    setHasDescription: item.setHasDescription,
    error,
    isEmpty: value === '' || value === undefined || value === null,
  };
}

/**
 * The wrapper of a label, its control and the message. With the control right after the label
 * (`Input`, `Select`, `DatePicker`, a textarea), the label moves inside the field (W7, styles.css
 * `field-inside`); a checkbox group or a picker with its own wrapper keeps the label above.
 */
export function FormItem(props: HTMLAttributes<HTMLDivElement>) {
  const id = useId();
  const [hasDescription, setHasDescription] = useState(false);
  const value = useMemo(
    () => ({ id, hasDescription, setHasDescription }),
    [id, hasDescription, setHasDescription],
  );
  return (
    <FormItemContext.Provider value={value}>
      <div {...props} />
    </FormItemContext.Provider>
  );
}

export function FormLabel(props: ComponentProps<typeof LabelPrimitive.Root>) {
  const { controlId } = useFormField();
  return <Label htmlFor={controlId} {...props} />;
}

export function FormControl(props: ComponentProps<typeof Slot>) {
  const { controlId, descriptionId, messageId, hasDescription, error } = useFormField();
  // Only what is rendered: the hint while there is one, the message while there is an error.
  const describedBy = [hasDescription ? descriptionId : null, error ? messageId : null]
    .filter((id) => id !== null)
    .join(' ');
  return (
    <Slot
      id={controlId}
      aria-invalid={error !== undefined}
      aria-describedby={describedBy || undefined}
      {...props}
    />
  );
}

/**
 * A hint under the control, linked to it with `aria-describedby` while rendered. The web shows no
 * hint text under a field: a rule the field has is said by its message when it is
 * broken. Kept for a screen that must say something a message cannot.
 */
export function FormDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId, setHasDescription } = useFormField();
  useEffect(() => {
    setHasDescription(true);
    return () => setHasDescription(false);
  }, [setHasDescription]);
  return <p id={descriptionId} className={cn('mt-1 text-xs text-muted', className)} {...props} />;
}

/** The field's error as text; nothing while the field is valid. */
export function FormMessage({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { messageId, error, isEmpty } = useFormField();
  if (!error) return null;
  return (
    <p id={messageId} className={cn('mt-1 text-xs text-danger', className)} {...props}>
      {validationMessage(error, isEmpty)}
    </p>
  );
}
