import type { ReactNode } from 'react';

/**
 * The marks of the sidebar items, drawn like the app logo (24 grid, round caps): each section has
 * its own (docs/design/Sidebar.dc.html). Zákazníci is the network of contacts, Súbory the
 * figure in a folder.
 */
export type NavMarkProps = { className?: string; 'aria-hidden'?: boolean };

function Mark({ children, ...props }: NavMarkProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const OverviewMark = (props: NavMarkProps) => (
  <Mark {...props}>
    <path d="M6 3.5h12A2.5 2.5 0 0 1 20.5 6v12a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5z" />
    <path d="M8 16.5v-3M12 16.5v-7M16 16.5v-4.5" />
  </Mark>
);

export const CustomersMark = (props: NavMarkProps) => (
  <Mark {...props}>
    <path d="M8.6 14.2a3.4 3.4 0 0 0 6.8 0" />
    <path d="M6.3 6.3l2.4 2.4M17.7 6.3l-2.4 2.4M6.3 17.7l1.9-1.9M17.7 17.7l-1.9-1.9" />
    <circle cx="12" cy="10.6" r="2" />
    <circle cx="5" cy="5" r="1.6" />
    <circle cx="19" cy="5" r="1.6" />
    <circle cx="5" cy="19" r="1.6" />
    <circle cx="19" cy="19" r="1.6" />
  </Mark>
);

export const EmailsMark = (props: NavMarkProps) => (
  <Mark {...props}>
    <path d="M4 5.5h16A1.5 1.5 0 0 1 21.5 7v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5z" />
    <path d="m3 7.5 9 6 9-6" />
  </Mark>
);

export const FilesMark = (props: NavMarkProps) => (
  <Mark {...props}>
    <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M8.6 15.4a3.4 3.4 0 0 0 6.8 0" />
    <circle cx="12" cy="12.2" r="1.8" />
  </Mark>
);

/** Produkty: a box, what a customer buys. */
export const ProductsMark = (props: NavMarkProps) => (
  <Mark {...props}>
    <path d="M12 3.2 20 7.6v8.8L12 20.8l-8-4.4V7.6z" />
    <path d="M4.3 7.8 12 12l7.7-4.2M12 12v8.6" />
  </Mark>
);

export const SettingsMark = (props: NavMarkProps) => (
  <Mark {...props}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Mark>
);
