import { sk } from '@intra/shared/i18n';
import { ORGANIZATION_ROLES } from '@intra/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import {
  CustomerForm,
  emptyCustomer,
  useCurrentUserId,
} from '@/components/customers/customer-form';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/components/ui/toast';
import { errorMessage, errorReason } from '@/lib/errors';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/customers/new')({
  // „Nový zákazník“ or „Nový partner“: the tab it was opened from.
  validateSearch: z.object({ role: z.enum(ORGANIZATION_ROLES).optional() }),
  component: NewCustomerPage,
});

const t = sk.customers;

function NewCustomerPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const { role = 'customer' } = Route.useSearch();
  const create = useMutation(
    trpc.customer.create.mutationOptions({
      onSuccess: async (created) => {
        toast('success', t.form.created);
        await queryClient.invalidateQueries(trpc.customer.pathFilter());
        await navigate({ to: '/customers/$customerId', params: { customerId: created.id } });
      },
      onError: (error) => {
        // A refusal about one field stays under it; the rest is a toast.
        if (errorReason(error) !== 'ICO_TAKEN') toast('error', errorMessage(error, t.errors));
      },
    }),
  );
  return (
    <div className="min-w-0">
      <PageHeader
        title={role === 'partner' ? sk.organizations.newPartner : sk.organizations.newCustomer}
        back={{
          to: role === 'partner' ? '/organizations/partners' : '/organizations/customers',
          label: t.form.back,
        }}
      />
      <div className="max-w-[1100px] px-7 pt-5 pb-10">
        <CustomerForm
          initial={emptyCustomer(userId, role)}
          editing={false}
          pending={create.isPending}
          serverError={create.error}
          onSubmit={(input) => create.mutate(input)}
          onCancel={() =>
            void navigate({
              to: role === 'partner' ? '/organizations/partners' : '/organizations/customers',
            })
          }
        />
      </div>
    </div>
  );
}
