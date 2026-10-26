import { sk } from '@intra/shared/i18n';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { DotField } from '@/components/dot-field';
import { cn } from '@/lib/utils';

/**
 * The public layout of HS-0, HS-0b, HS-0c and SA-4 (ALMA-268, Figma W30, variant S2-1): two halves.
 * Left, the dark panel: a dot grid that a soft wave of light crosses now and then and that lights
 * up under the cursor (`DotField`, ALMA-288 item 13), the logo top-left, the claim in the middle
 * and the trust lines at the bottom. Right, the canvas with a faint accent glow
 * behind the card.
 *
 * ALMA-285 item 10: the claim is centred on the panel's height, so it stands level with the card,
 * which is centred on the window (three rows, the outer two equal). The panel takes 45 % of the
 * window, at least 520 px and at most 820, so a wide screen is not half empty dark teal. On a
 * phone the panel is hidden and the logo stands above the card.
 */
export function BrandLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(520px,min(45%,820px))_minmax(0,1fr)]">
      <aside className="relative hidden grid-rows-[1fr_auto_1fr] overflow-hidden bg-ink p-10 text-white lg:grid">
        {/* The dot grid: 1 px dots of the active icon's colour at 20 %, every 18 px. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle,rgba(95,208,201,0.2)_1px,transparent_1.5px)] bg-[length:18px_18px]"
        />
        {/* ALMA-288 item 13: a wave of light every ~7 s and a spotlight at the cursor, on the
            same dots; static with prefers-reduced-motion. No breathing glow any more. */}
        <DotField />
        <BrandName className="relative self-start" />
        <div className="relative py-10">
          <p className="max-w-[520px] text-[44px] leading-[1.1] font-bold tracking-[-0.02em]">
            {sk.brand.tagline}
          </p>
          <p className="mt-5 max-w-md text-[15px] leading-[21px] text-sidebar-text">
            {sk.brand.description}
          </p>
        </div>
        <ul className="relative space-y-1.5 self-end text-xs font-medium text-trust">
          {sk.brand.badges.map((badge) => (
            <li key={badge} className="flex items-center gap-2">
              <Check className="size-3.5 text-sidebar-icon-active" aria-hidden />
              {badge}
            </li>
          ))}
        </ul>
      </aside>
      <main className="relative flex items-center justify-center bg-surface p-6">
        {/* The glow is clipped on its own: the note under the card may hang below the window. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 size-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(15,139,141,0.13)_0%,rgba(15,139,141,0)_70%)]" />
        </div>
        <div className="relative flex w-full max-w-[440px] flex-col items-center">
          {/* The panel is hidden on a phone: the logo comes with the card instead. */}
          <BrandName className="mb-8 text-foreground lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}

/** The logo and the name, top-left on the panel and above the card on a phone. */
function BrandName({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 text-lg font-semibold', className)}>
      <BrandMark className="size-10" />
      {sk.brand.name}
    </div>
  );
}

/** The card of every public screen: 440 wide, rounded 20, Elevation/3 with the light edge, 32 padding. */
export const brandCardClass =
  'w-full rounded-[20px] bg-white p-8 shadow-[var(--shadow-edge),var(--shadow-floating)]';

/** The title of the card, App/Title, and the one line under it. */
export function BrandCardTitle({ title, text }: { title: string; text?: string | undefined }) {
  return (
    <>
      <h1 className="text-[22px] leading-7 font-bold tracking-[-0.01em]">{title}</h1>
      {text ? <p className="mt-1.5 text-[13px] leading-[18px] text-muted">{text}</p> : null}
    </>
  );
}

/**
 * The small print under the card (W30: Caption tertiary, outside the card). Beside the panel it
 * hangs under the card instead of being centred with it, so the card's middle is the window's
 * and the claim on the left stands level with it (ALMA-285 item 10).
 */
export function BrandCardNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 max-w-sm text-center text-xs text-tertiary lg:absolute lg:top-full lg:left-1/2 lg:w-full lg:-translate-x-1/2 lg:pb-6">
      {children}
    </p>
  );
}
