import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A section of a long form: the heading in a 240 px column on the left,
 * the fields on the right; in a card narrower than 64 rem (a wizard beside its source document)
 * the heading stands above the fields. The card is the container (`@container` on it), so the
 * layout follows the card's width, not the window's. Sections in one card are separated by a
 * line; the fields area is a container of its own, so a row of fields inside it can say
 * `@md:grid-cols-2 @2xl:grid-cols-3` and never fall below a readable width.
 */
export function FormSection({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        'grid gap-5 border-t border-border-subtle pt-6 first:border-t-0 first:pt-0 @5xl:grid-cols-[240px_minmax(0,1fr)]',
        className,
      )}
    >
      <h2 className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="@container min-w-0">{children}</div>
    </section>
  );
}
