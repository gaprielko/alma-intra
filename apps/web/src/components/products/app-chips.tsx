import { sk } from '@intra/shared/i18n';
import { PRODUCT_APPS, type ProductApp } from '@intra/shared/schemas';

/** The applications a role reaches, always in the same order. */
export function AppChips({ apps }: { apps: readonly ProductApp[] }) {
  return (
    <span className="inline-flex gap-1">
      {PRODUCT_APPS.filter((app) => apps.includes(app)).map((app) => (
        <span
          key={app}
          className="inline-flex h-[22px] items-center rounded-md border border-border-subtle bg-surface px-2 text-xs font-medium whitespace-nowrap text-muted"
        >
          {sk.products.apps[app]}
        </span>
      ))}
    </span>
  );
}
