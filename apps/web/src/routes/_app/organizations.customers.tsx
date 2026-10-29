import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  merge,
  OrganizationList,
  organizationSearch,
} from '@/components/customers/organization-list';

export const Route = createFileRoute('/_app/organizations/customers')({
  validateSearch: organizationSearch,
  component: CustomersTab,
});

/** Organizácie › Zákazníci. */
function CustomersTab() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <OrganizationList
      role="customer"
      params={params}
      setSearch={(next, keepPage = false) =>
        void navigate({ search: merge(next, keepPage), replace: true })
      }
    />
  );
}
