import { sk } from '@intra/shared/i18n';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

/** A section of the sidebar that a later release fills: its header and „Pripravujeme“. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <EmptyState title={sk.shell.comingSoon.title} text={sk.shell.comingSoon.text} />
      </div>
    </>
  );
}
