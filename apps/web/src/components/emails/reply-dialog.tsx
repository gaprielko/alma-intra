import { sk } from '@intra/shared/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { trpc } from '@/lib/trpc';

const t = sk.inbound;

/** „Odpovedať“: an answer to a received e-mail, from its detail or right from its row. */
export function ReplyDialog({
  inboundId,
  to,
  onClose,
}: {
  inboundId: string;
  to: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const send = useMutation(
    trpc.inbound.reply.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.activity.timeline.pathFilter());
        await queryClient.invalidateQueries(trpc.inbound.pathFilter());
        await queryClient.invalidateQueries(trpc.campaign.pathFilter());
        toast('success', t.replyDialog.sent);
        onClose();
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const d = t.replyDialog;
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title(to)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            aria-label={d.text}
            placeholder={d.text}
            rows={8}
            maxLength={10_000}
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="text-xs text-muted">{d.quoted}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={!text.trim() || send.isPending}
            onClick={() => send.mutate({ id: inboundId, text })}
          >
            {d.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
