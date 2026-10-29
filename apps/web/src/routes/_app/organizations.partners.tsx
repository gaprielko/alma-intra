import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  merge,
  OrganizationList,
  organizationSearch,
} from '@/components/customers/organization-list';

export const Route = createFileRoute('/_app/organizations/partners')({
  validateSearch: organizationSearch,
  component: PartnersTab,
});

/** Organizácie › Partneri. */
function PartnersTab() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <OrganizationList
      role="partner"
      params={params}
      setSearch={(next, keepPage = false) =>
        void navigate({ search: merge(next, keepPage), replace: true })
      }
    />
  );
}
