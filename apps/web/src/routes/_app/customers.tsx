import { sk } from '@intra/shared/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { ComingSoon } from '@/components/coming-soon';

export const Route = createFileRoute('/_app/customers')({
  component: () => <ComingSoon title={sk.shell.nav.customers} />,
});
