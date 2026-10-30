import { sk } from '@intra/shared/i18n';
import type { AnswerMode } from '@intra/shared/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DirectComposer } from '@/components/emails/direct-composer';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.inbound.replyDraft;

/**
 * An answer or a forward being written, as a new row of the conversation: opened, with the same
 * fields as „Nový e-mail“; a click on its head folds it, and what is typed stays.
 */
export function ReplyDraftRow({ id, mode }: { id: string; mode: AnswerMode | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const draft = useQuery({
    ...trpc.campaign.getDirect.queryOptions({ id }),
    // The form takes over from here: a refetch must not overwrite what is being typed.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const look = useQuery(trpc.template.look.queryOptions());
  if (!draft.data || !look.data) return null;
  const leave = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.campaign.replyDrafts.pathFilter()),
      queryClient.invalidateQueries(trpc.inbound.pathFilter()),
      queryClient.invalidateQueries(trpc.activity.timeline.pathFilter()),
    ]);
  };
  const title = t.titles[mode ?? 'reply'];
  return (
    <DirectComposer draft={draft.data} look={look.data.look} onSent={leave} onDiscarded={leave}>
      {({ fields, send, discard, from }) => (
        <section aria-label={title} className="border-b border-border-subtle">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((now) => !now)}
            className="block w-full px-5 py-3.5 text-left text-sm hover:bg-hover"
          >
            <span className="block font-bold">{title}</span>
            <span className="block text-muted">
              {from} · {t.saved}
            </span>
          </button>
          <div className={cn('border-t border-border-subtle', !open && 'hidden')}>
            {fields}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-5 py-3">
              {send}
              {discard}
            </div>
          </div>
        </section>
      )}
    </DirectComposer>
  );
}
