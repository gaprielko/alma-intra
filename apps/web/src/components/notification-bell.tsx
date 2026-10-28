import { sk } from '@intra/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bell, MailWarning, Reply } from 'lucide-react';
import { useState } from 'react';
import { SidebarButton } from '@/components/app-sidebar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatRecent } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.notifications;
/** How often the count is asked again while the app is open. */
const REFRESH_MS = 60_000;

/**
 * „Upozornenia“ in the sidebar: replies to one's e-mails and e-mails that bounced, the unread
 * counted on the bell. One opens what it is about and counts as read.
 */
export function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ ...trpc.notification.list.queryOptions(), refetchInterval: REFRESH_MS });
  const markRead = useMutation(
    trpc.notification.markRead.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.notification.pathFilter()),
    }),
  );
  const items = list.data?.items ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SidebarButton
          icon={Bell}
          label={t.title}
          collapsed={collapsed}
          count={list.data?.unread ?? 0}
        />
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <p className="text-sm font-semibold">{t.title}</p>
          {(list.data?.unread ?? 0) > 0 ? (
            <button
              type="button"
              className="text-xs font-medium text-primary-text hover:underline"
              onClick={() => markRead.mutate({})}
            >
              {t.markAll}
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">{t.empty}</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border-subtle overflow-y-auto">
            {items.map((item) => {
              const Icon = item.kind === 'reply' ? Reply : MailWarning;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full gap-3 px-4 py-3 text-left hover:bg-hover',
                      !item.readAt && 'bg-primary-soft/40',
                    )}
                    onClick={() => {
                      setOpen(false);
                      if (!item.readAt) markRead.mutate({ ids: [item.id] });
                      void (item.kind === 'reply'
                        ? navigate({
                            to: '/emails/inbox/$inboundId',
                            params: { inboundId: item.refId },
                          })
                        : navigate({
                            to: '/emails/sent/$campaignId',
                            params: { campaignId: item.refId },
                          }));
                    }}
                  >
                    <Icon
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        item.kind === 'bounce' ? 'text-danger' : 'text-primary-text',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {item.kind === 'reply'
                          ? t.reply(item.customerName)
                          : t.bounce(item.customerName)}
                      </span>
                      {item.subject ? (
                        <span className="block truncate text-xs text-muted">{item.subject}</span>
                      ) : null}
                      <span className="block text-xs text-muted">
                        {formatRecent(item.createdAt)}
                      </span>
                    </span>
                    {item.readAt ? null : (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">{t.unread}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
