import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one Button of the web, shared in look with the phone's: the primary and
 * the danger one are a gradient with the light edge on top and a shadow underneath, the secondary
 * is tonal (accent/soft, no border), the ghost is only its text. A press squeezes it to 0.98 for
 * 80 ms. Heights: 40 by default, 32 in a table row or a dialog footer (`sm`), 48 on the login
 * card (`lg`), 36 for an icon alone (`icon`: rounded 10, bordered, give it a tooltip).
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap transition-[background-color,box-shadow,color,transform,opacity] duration-150 ease-out-soft outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98] active:duration-[80ms] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:active:scale-100',
  {
    variants: {
      variant: {
        primary:
          'bg-primary bg-linear-to-b from-[#139698] to-[#0b6e70] text-primary-foreground shadow-edge-button hover:from-[#179fa1] hover:to-[#0d7678] hover:shadow-[var(--shadow-edge),var(--shadow-raised)] disabled:shadow-none',
        /** Tonal: the accent at its softest, no border. */
        secondary: 'bg-primary-soft text-primary-text hover:bg-[#d6ebe9]',
        ghost: 'text-primary-text hover:bg-primary-soft',
        /** The confirm button of a destructive action (`ConfirmDialog`), named by what it does. */
        danger:
          'bg-danger bg-linear-to-b from-[#d33a3f] to-[#b0232a] text-white shadow-edge-button hover:from-[#da4348] hover:to-[#b9292f] disabled:shadow-none',
      },
      size: {
        md: 'h-10 px-4 text-sm',
        sm: 'h-8 px-3 text-[13px]',
        lg: 'h-12 px-5 text-[15px]',
        /** Whatever the variant says: the icon button is white, bordered, without the gradient. */
        icon: 'size-9 border border-border bg-white bg-none text-muted shadow-none hover:bg-hover hover:text-foreground hover:from-transparent hover:to-transparent hover:shadow-none',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** The child (a `Link`) is the button: it takes the classes instead of a `<button>`. */
    asChild?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  type = 'button',
  asChild = false,
  ...props
}: ButtonProps) {
  if (asChild) {
    return <Slot className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  }
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
