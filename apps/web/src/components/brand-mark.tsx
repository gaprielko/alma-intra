import { cn } from '@/lib/utils';

/**
 * The Alma Intra logo: the Alma figure in a speech bubble, teal on a dark tile (the reverse of the
 * Alma ADOS logo, so the two apps tell apart in a browser tab). `assets/icon.svg` draws the same.
 * Decorative: the name always stands next to it.
 */
export function BrandMark({
  className,
  title,
}: {
  className?: string;
  title?: string | undefined;
}) {
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-[28.125%] bg-linear-160 from-[#135a5b] to-[#0a3233] text-sidebar-icon-active shadow-[inset_0_0_0_1px_rgba(95,208,201,0.35)]',
        className,
      )}
      title={title}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[62.5%]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v10a1.5 1.5 0 0 1-1.5 1.5h-7.5L8 21v-3.5H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5z" />
        <path d="M7.5 9.5v.6a3.4 3.4 0 0 0 3.4 3.4" />
        <path d="M16.5 9.5v.6a3.4 3.4 0 0 1-3.4 3.4" />
        <circle cx="12" cy="8.8" r="1.9" />
      </svg>
    </span>
  );
}
