import { sk } from '@intra/shared/i18n';
import { Link } from '@tanstack/react-router';
import { Mail, Reply } from 'lucide-react';
import { formatDay, KindMark } from '@/components/activities/activity-bits';
import { Badge } from '@/components/ui/badge';
import { formatRecent } from '@/lib/format';
import type { RouterOutputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * The entries of a timeline (an organization's, or a person's): an activity, a sent e-mail, a
 * received one. Shared by the organization and the person detail.
 */

const a = sk.activities;

export type TimelineActivity = Extract<
  RouterOutputs['activity']['timeline'][number],
  { type: 'activity' }
>['activity'];

export type TimelineEmail = Extract<
  RouterOutputs['activity']['timeline'][number],
  { type: 'email' }
>['email'];

/** A sent e-mail in the timeline: the subject, to whom, its delivery; opens the campaign. */
export function EmailItem({ item }: { item: TimelineEmail }) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className="absolute top-0 -left-[41px] inline-flex size-7 items-center justify-center rounded-full bg-[#e9eef6] text-[#334e7b]"
      >
        <Mail className="size-3.5" />
      </span>
      <Link
        to="/emails/sent/$campaignId"
        params={{ campaignId: item.campaignId }}
        className="block rounded-lg hover:bg-hover/60"
      >
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {a.timeline.email(item.subject ?? '')}
          <Badge tone={EMAIL_TONE[item.status]} dot>
            {sk.campaigns.status[item.status]}
          </Badge>
        </p>
        <p className="text-xs text-muted">
          {a.timeline.emailBy(item.sender, item.toName ?? sk.common.none, formatRecent(item.at))}
        </p>
      </Link>
    </li>
  );
}

export type TimelineReply = Extract<
  RouterOutputs['activity']['timeline'][number],
  { type: 'reply' }
>['reply'];

/** A received e-mail in the timeline: the subject, who wrote, the first words; opens it. */
export function ReplyItem({ item }: { item: TimelineReply }) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className="absolute top-0 -left-[41px] inline-flex size-7 items-center justify-center rounded-full bg-[#e6f4ef] text-[#1d6b52]"
      >
        <Reply className="size-3.5" />
      </span>
      <Link
        to="/emails/inbox/$inboundId"
        params={{ inboundId: item.id }}
        className="block rounded-lg hover:bg-hover/60"
      >
        <p className="text-sm font-semibold">
          {a.timeline.reply(item.subject || sk.inbound.noSubject)}
        </p>
        <p className="text-xs text-muted">
          {a.timeline.replyFrom(item.fromName ?? item.fromEmail, formatRecent(item.at))}
          {item.attachmentCount > 0 ? ` · ${sk.inbound.attachments(item.attachmentCount)}` : ''}
        </p>
        {item.preview ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted">{item.preview}</p>
        ) : null}
      </Link>
    </li>
  );
}

const EMAIL_TONE = {
  draft: 'neutral',
  skipped: 'neutral',
  queued: 'info',
  sent: 'info',
  delivered: 'success',
  bounced: 'danger',
  complained: 'danger',
  failed: 'danger',
} as const;

/** One activity in the timeline: its mark, a heading, who and when, the start of the notes. */
export function ActivityItem({ item, onOpen }: { item: TimelineActivity; onOpen: () => void }) {
  const contacts = item.participants.filter((p) => p.kind === 'contact').map((p) => p.name);
  const heading = [
    item.subject ?? a.kinds[item.kind],
    item.kind === 'note' || contacts.length === 0 ? null : a.timeline.with(contacts.join(', ')),
    item.durationMin ? a.duration.format(item.durationMin) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="relative">
      <span className="absolute -left-[41px] top-0">
        <KindMark kind={item.kind} size="sm" />
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-lg text-left hover:bg-hover/60 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <p className="text-sm font-semibold">
          {item.subject ? `${a.kinds[item.kind]}: ` : ''}
          {heading}
        </p>
        <p className="text-xs text-muted">
          {a.timeline.by(item.author ?? sk.common.none, formatRecent(item.occurredAt))}
        </p>
        {item.bodyText ? (
          <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-foreground/90">
            {item.bodyText}
          </p>
        ) : null}
        {item.nextStepText ? (
          <p
            className={cn(
              'mt-1 text-[13px] font-medium',
              item.nextStepDoneAt ? 'text-muted line-through' : 'text-primary-text',
            )}
          >
            {item.nextStepDue
              ? a.timeline.nextStepDue(item.nextStepText, formatDay(item.nextStepDue))
              : a.timeline.nextStep(item.nextStepText)}
          </p>
        ) : null}
        {item.attachmentCount > 0 ? (
          <p className="mt-1 text-xs text-muted">{a.timeline.attachments(item.attachmentCount)}</p>
        ) : null}
      </button>
    </li>
  );
}
