import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/_app/settings/pricing')({ component: PricingSettings });

const v = sk.products.vat;

/** Nastavenia › Ceny a DPH: the VAT rate the prices with VAT are computed with (R-9). */
function PricingSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan('pricing.manage');
  const current = useQuery(trpc.product.vatRate.queryOptions());
  const [rate, setRate] = useState('');
  useEffect(() => {
    if (current.data) setRate(String(current.data.vatRate).replace('.', ','));
  }, [current.data]);
  const save = useMutation(
    trpc.product.setVatRate.mutationOptions({
      onSuccess: async () => {
        toast('success', v.saved);
        await queryClient.invalidateQueries(trpc.product.pathFilter());
      },
      onError: (error) => toast('error', errorMessage(error)),
    }),
  );
  const value = Number(rate.replace(',', '.'));
  const valid = rate.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100;
  return (
    <main className="max-w-[760px] px-7 pt-5 pb-10">
      <Card>
        <CardHeader title={v.title} />
        <form
          className="grid gap-4 p-5 sm:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) save.mutate({ vatRate: value });
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="vat-rate">{v.rate}</Label>
            <Input
              id="vat-rate"
              inputMode="decimal"
              value={rate}
              disabled={!canManage}
              onChange={(event) => setRate(event.target.value)}
            />
          </div>
          <p className="self-center text-[13px] text-muted sm:col-span-4">{v.hint}</p>
          <p className="flex gap-2.5 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] text-warning sm:col-span-6">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {v.change}
          </p>
          {canManage ? (
            <div className="flex justify-end sm:col-span-6">
              <Button type="submit" disabled={!valid || save.isPending}>
                {save.isPending ? sk.common.saving : sk.common.save}
              </Button>
            </div>
          ) : null}
        </form>
      </Card>
    </main>
  );
}
