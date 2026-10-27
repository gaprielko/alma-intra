import { sk } from '@intra/shared/i18n';
import type { MessageStatus } from '@intra/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton } from '@/components/skeletons';
import { TableShell } from '@/components/table-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBanner } from '@/components/ui/status-banner';
import { TableCell, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { trpc } from '@/lib/trpc';

const t = sk.campaigns;

export const Route = createFileRoute('/_app/emails_/sent/$campaignId')({
  component: CampaignPage,
});

export const STATUS_TONE: Record<MessageStatus, BadgeTone> = {
  draft: 'neutral',
  skipped: 'neutral',
  queued: 'info',
  sent: 'info',
  delivered: 'success',
  bounced: 'danger',
  complained: 'danger',
  failed: 'danger',
};

function Stat({
  label,
  value,
  hint,
  danger = false,
}: {
  label: string;
  value: number;
  hint: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-white p-5 shadow-rest">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p
        className={
          danger && value > 0
            ? 'mt-1 text-[28px] font-bold text-danger'
            : 'mt-1 text-[28px] font-bold'
        }
      >
        {value}
      </p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

/** A sent campaign: who got it, what came of it, and each recipient's exact e-mail. */
function CampaignPage() {
  const { campaignId } = Route.useParams();
  const campaign = useQuery({
    ...trpc.campaign.get.queryOptions({ id: campaignId }),
    // While it is leaving, its numbers move.
    refetchInterval: (query) => (query.state.data?.status === 'sending' ? 5000 : false),
  });
  const [shown, setShown] = useState<string | null>(null);
  if (campaign.isPending) {
    return (
      <div className="min-w-0">
        <PageHeader title={sk.common.loading} back={{ to: '/emails/sent', label: t.detail.back }} />
        <div className="p-7">
          <CardSkeleton lines={6} />
        </div>
      </div>
    );
  }
  if (loadFailed(campaign)) {
    return (
      <div className="min-w-0">
        <PageHeader title={t.list.sent} back={{ to: '/emails/sent', label: t.detail.back }} />
        <ErrorState
          text={errorMessage(campaign.error, t.errors)}
          onRetry={() => void campaign.refetch()}
        />
      </div>
    );
  }
  const c = campaign.data;
  const sent = c.messages.filter((m) => m.status !== 'skipped');
  const skipped = c.messages.length - sent.length;
  const delivered = sent.filter((m) => m.status === 'delivered').length;
  const bounced = sent.filter((m) => ['bounced', 'complained', 'failed'].includes(m.status)).length;
  const waiting = sent.length - delivered - bounced;
  const d = t.detail;
  return (
    <div className="min-w-0">
      <PageHeader
        title={c.subjectText ?? t.list.noSubject}
        subtitle={d.meta(c.sender.name, c.sentAt ? formatDateTime(c.sentAt) : '', c.templateName)}
        back={{ to: '/emails/sent', label: d.back }}
        badge={
          c.status === 'sending' ? (
            <Badge tone="info" dot>
              {t.list.sending}
            </Badge>
          ) : undefined
        }
      />
      <main className="max-w-[1440px] space-y-5 px-7 pt-5 pb-10">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={d.stats.sent} value={sent.length} hint={d.stats.sentHint(skipped)} />
          <Stat label={d.stats.delivered} value={delivered} hint={d.stats.deliveredHint} />
          <Stat label={d.stats.bounced} value={bounced} hint={d.stats.bouncedHint} danger />
          <Stat label={d.stats.waiting} value={waiting} hint={d.stats.waitingHint} />
        </div>
        {bounced > 0 ? <StatusBanner tone="warning">{d.bouncedNote}</StatusBanner> : null}
        <TableShell
          columns={[
            d.columns.recipient,
            d.columns.email,
            d.columns.delivery,
            <span key="a" className="sr-only">
              {d.columns.actions}
            </span>,
          ]}
        >
          {c.messages.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <p className="font-semibold">{m.name}</p>
                <p className="text-xs text-muted">{m.customerName}</p>
              </TableCell>
              <TableCell className="text-muted">{m.email ?? sk.common.none}</TableCell>
              <TableCell>
                <Badge tone={STATUS_TONE[m.status]} dot>
                  {m.status === 'skipped' && m.skipReason
                    ? `${t.status.skipped} · ${t.skip[m.skipReason]}`
                    : t.status[m.status]}
                </Badge>
                <p className="mt-0.5 text-xs text-muted">
                  {m.deliveredAt
                    ? formatDateTime(m.deliveredAt)
                    : m.bouncedAt
                      ? formatDateTime(m.bouncedAt)
                      : m.sentAt
                        ? formatDateTime(m.sentAt)
                        : null}
                </p>
              </TableCell>
              <TableCell className="text-right">
                {m.status !== 'skipped' ? (
                  <Button variant="ghost" size="sm" onClick={() => setShown(m.id)}>
                    {d.show}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableShell>
      </main>
      {shown ? <SentMessage messageId={shown} onClose={() => setShown(null)} /> : null}
    </div>
  );
}

/** The exact copy a recipient got. */
function SentMessage({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const preview = useQuery(trpc.campaign.preview.queryOptions({ messageId }));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{preview.data?.subject ?? t.detail.frame}</DialogTitle>
          {preview.data ? (
            <p className="text-[13px] text-muted">
              {t.preview.from(preview.data.from)} · {preview.data.to}
            </p>
          ) : null}
        </DialogHeader>
        {preview.data ? (
          <iframe
            title={t.detail.frame}
            // No scripts: only the e-mail's HTML; the origin is kept so that it paints.
            sandbox="allow-same-origin"
            srcDoc={preview.data.html}
            className="block h-[70vh] w-full rounded-lg border-0 bg-[#f4f6f6]"
          />
        ) : (
          <CardSkeleton lines={8} />
        )}
      </DialogContent>
    </Dialog>
  );
}
