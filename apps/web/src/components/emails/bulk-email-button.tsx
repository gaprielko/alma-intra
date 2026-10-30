import { sk } from '@intra/shared/i18n';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';

/** „Hromadný e-mail“: starts an empty draft in the wizard; nothing for whom may not send. */
export function BulkEmailButton({ size }: { size?: 'sm' | undefined }) {
  const toast = useToast();
  const navigate = useNavigate();
  const canSend = useCan('email.send');
  const create = useMutation(
    trpc.campaign.create.mutationOptions({
      onSuccess: (created) =>
        navigate({ to: '/emails/compose/$campaignId', params: { campaignId: created.id } }),
      onError: (error) => toast('error', errorMessage(error, sk.campaigns.errors)),
    }),
  );
  if (!canSend) return null;
  return (
    <Button
      size={size}
      variant="secondary"
      disabled={create.isPending}
      onClick={() => create.mutate({ customerIds: [] })}
    >
      <Plus className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden />
      {sk.campaigns.bulkEmail}
    </Button>
  );
}
