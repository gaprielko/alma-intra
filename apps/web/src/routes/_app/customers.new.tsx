import { sk } from '@intra/shared/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  CustomerForm,
  emptyCustomer,
  useCurrentUserId,
} from '@/components/customers/customer-form';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/components/ui/toast';
import { errorMessage, errorReason } from '@/lib/errors';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/customers/new')({ component: NewCustomerPage });

const t = sk.customers;

function NewCustomerPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
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
        title={t.form.newTitle}
        back={{ to: '/organizations/customers', label: t.form.back }}
      />
      <div className="max-w-[1100px] px-7 pt-5 pb-10">
        <CustomerForm
          initial={emptyCustomer(userId)}
          editing={false}
          pending={create.isPending}
          serverError={create.error}
          onSubmit={(input) => create.mutate(input)}
          onCancel={() => void navigate({ to: '/organizations/customers' })}
        />
      </div>
    </div>
  );
}
