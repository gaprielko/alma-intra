import { createFileRoute } from '@tanstack/react-router';
import { CatalogPage } from '@/components/products/catalog-page';

export const Route = createFileRoute('/_app/products/others')({
  component: () => <CatalogPage kind="other" />,
});
