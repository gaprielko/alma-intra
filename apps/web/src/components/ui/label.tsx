import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * A field's name. Followed by its field in the same wrapper, it moves inside the field, above
 * the value (ALMA-268, W7; styles.css `field-inside`); elsewhere it is a line of text above.
 */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('block text-sm font-medium', className)} {...props} />;
}
