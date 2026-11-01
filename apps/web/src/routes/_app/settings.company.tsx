import { sk } from '@intra/shared/i18n';
import type { Company } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { CardSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';

const t = sk.company;

export const Route = createFileRoute('/_app/settings/company')({ component: CompanyPage });

/** Nastavenia › Firma: what is true of the company everywhere in Intra. */
function CompanyPage() {
  const company = useQuery(trpc.template.company.queryOptions());
  if (company.isPending) {
    return (
      <div className="max-w-[35rem] px-7 pt-5 pb-10">
        <CardSkeleton lines={3} />
      </div>
    );
  }
  if (loadFailed(company)) return <ErrorState onRetry={() => void company.refetch()} />;
  return <CompanyForm initial={company.data} />;
}

function CompanyForm({ initial }: { initial: Company }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan('company.manage');
  const ids = useId();
  const [name, setName] = useState(initial.name);
  const [ico, setIco] = useState(initial.ico);
  const save = useMutation(
    trpc.template.updateCompany.mutationOptions({
      onSuccess: async () => {
        toast('success', t.saved);
        await queryClient.invalidateQueries(trpc.template.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error, sk.validation)),
    }),
  );
  const dirty = name !== initial.name || ico !== initial.ico;
  return (
    <div className="px-7 pt-5 pb-10">
      <form
        className="max-w-[35rem] space-y-5 rounded-2xl border border-border-subtle bg-white p-5 shadow-rest"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ name, ico });
        }}
      >
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">{t.section}</h2>
          <div className="space-y-2">
            <Label htmlFor={`${ids}-name`}>{t.name}</Label>
            <Input
              id={`${ids}-name`}
              maxLength={200}
              value={name}
              disabled={!canManage}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${ids}-ico`}>{t.ico}</Label>
            <Input
              id={`${ids}-ico`}
              maxLength={20}
              value={ico}
              disabled={!canManage}
              onChange={(event) => setIco(event.target.value)}
            />
          </div>
        </section>
        {canManage ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || save.isPending}>
              {t.save}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
