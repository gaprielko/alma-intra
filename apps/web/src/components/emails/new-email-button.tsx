import { sk } from '@intra/shared/i18n';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';

/** „Nový e-mail“: one e-mail to its To, Cc and Bcc; nothing for whom may not send. */
export function NewEmailButton({ size }: { size?: 'sm' | undefined }) {
  const toast = useToast();
  const navigate = useNavigate();
  const canSend = useCan('email.send');
  const create = useMutation(
    trpc.campaign.createDirect.mutationOptions({
      onSuccess: (created) =>
        navigate({ to: '/emails/new/$campaignId', params: { campaignId: created.id } }),
      onError: (error) => toast('error', errorMessage(error, sk.campaigns.errors)),
    }),
  );
  if (!canSend) return null;
  return (
    <Button size={size} disabled={create.isPending} onClick={() => create.mutate()}>
      <Plus className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden />
      {sk.directEmail.title}
    </Button>
  );
}
