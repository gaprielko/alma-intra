import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** W18: a tooltip waits 300 ms before it shows. */
const DELAY_MS = 300;

/**
 * A tooltip: the ink as background, 12 px medium text, rounded 6, no arrow;
 * it waits 300 ms and fades in 100 ms. Wrap the control (`asChild`: the control itself gets the
 * `aria-describedby`); the text is what the control would say with `title`, and it never replaces
 * a visible label or an `aria-label`. Each tooltip brings its own provider, so it works wherever
 * it is rendered, a test's markup included.
 *
 * ```tsx
 * <Tooltip text={sk.auth.logout}>
 *   <Button size="icon" aria-label={sk.auth.logout}>…</Button>
 * </Tooltip>
 * ```
 */
export function Tooltip({
  text,
  side = 'bottom',
  delay,
  children,
}: {
  text: ReactNode;
  side?: ComponentProps<typeof TooltipPrimitive.Content>['side'];
  /** The sidebar rail waits 200 ms; everything else the default 300. */
  delay?: number | undefined;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delay ?? DELAY_MS}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              'z-[60] max-w-xs rounded-md bg-foreground px-2 py-1 text-xs font-medium text-white motion-safe:animate-[fade-in_100ms_ease-out]',
            )}
          >
            {text}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
