import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  CustomerForm,
  type CustomerFormValues,
  emptyCustomer,
} from '@/components/customers/customer-form';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { useToast } from '@/components/ui/toast';
import { errorMessage, errorReason } from '@/lib/errors';
import { loadFailed } from '@/lib/query-view';
import { type RouterOutputs, trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/customers/$customerId/edit')({
  component: EditCustomerPage,
});

const t = sk.customers;

type Customer = RouterOutputs['customer']['get'];

/** The stored customer as the form's values; nothing stored is the empty field. */
function valuesOf(c: Customer): CustomerFormValues {
  const empty = emptyCustomer('');
  return {
    ...empty,
    customer: {
      ...empty.customer,
      kind: c.kind,
      contactTypeId: c.contactTypeId,
      name: c.name,
      ico: c.ico ?? '',
      dic: c.dic ?? '',
      icDph: c.icDph ?? '',
      web: c.web ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      typeId: c.typeId ?? '',
      status: c.status,
      street: c.street ?? '',
      postalCode: c.postalCode ?? '',
      city: c.city ?? '',
      region: c.region ?? '',
      ownerUserId: c.ownerUserId ?? '',
      sourceId: c.sourceId ?? '',
      tags: c.tags.map((tag) => tag.name),
      note: c.note ?? '',
      almaOrganizationId: c.almaOrganizationId ?? '',
      titleBefore: c.titleBefore ?? '',
      firstName: c.firstName ?? '',
      lastName: c.lastName ?? '',
      titleAfter: c.titleAfter ?? '',
      gender: c.gender ?? '',
      salutation: c.salutation ?? '',
      receivesBulk: c.unsubscribedAt === null,
    },
  };
}

function EditCustomerPage() {
  const { customerId } = Route.useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const customer = useQuery(trpc.customer.get.queryOptions({ id: customerId }));
  const back = () => navigate({ to: '/customers/$customerId', params: { customerId } });
  const update = useMutation(
    trpc.customer.update.mutationOptions({
      onSuccess: async () => {
        toast('success', t.form.saved);
        await queryClient.invalidateQueries(trpc.customer.pathFilter());
        await back();
      },
      onError: (error) => {
        if (errorReason(error) !== 'ICO_TAKEN') toast('error', errorMessage(error, t.errors));
      },
    }),
  );
  return (
    <div className="min-w-0">
      <PageHeader
        title={t.form.editTitle}
        subtitle={customer.data?.name}
        back={{
          to: '/customers/$customerId',
          params: { customerId },
          label: customer.data?.name ?? t.title,
        }}
      />
      <div className="max-w-[1100px] px-7 pt-5 pb-10">
        {customer.isPending ? (
          <CardSkeleton />
        ) : loadFailed(customer) ? (
          <ErrorState
            text={errorMessage(customer.error, t.errors)}
            onRetry={() => void customer.refetch()}
          />
        ) : (
          <CustomerForm
            initial={valuesOf(customer.data)}
            editing
            submitLabel={sk.common.saveChanges}
            pending={update.isPending}
            serverError={update.error}
            onSubmit={(input) => update.mutate({ id: customerId, customer: input.customer })}
            onCancel={() => void back()}
          />
        )}
      </div>
    </div>
  );
}
