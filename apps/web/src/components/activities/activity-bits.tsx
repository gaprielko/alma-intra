import { sk } from '@intra/shared/i18n';
import type { ActivityKind } from '@intra/shared/schemas';
import { FileText, type LucideIcon, Phone, Users, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

export const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  call: Phone,
  meeting: Users,
  video_call: Video,
  note: FileText,
};

/** Each kind's colours, as in the activity dialog's design. */
export const KIND_CLASS: Record<ActivityKind, string> = {
  call: 'bg-[#e6f1fb] text-[#0c447c]',
  meeting: 'bg-primary-soft text-primary-text',
  video_call: 'bg-[#eeedfe] text-[#3c3489]',
  note: 'bg-[#faeeda] text-[#854f0b]',
};

/** A kind's round mark: its icon on its colour. */
export function KindMark({ kind, size = 'md' }: { kind: ActivityKind; size?: 'sm' | 'md' }) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        size === 'sm' ? 'size-7' : 'size-8',
        KIND_CLASS[kind],
      )}
    >
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
    </span>
  );
}

export const kindLabel = (kind: ActivityKind) => sk.activities.kinds[kind];

/** `2026-10-31` from the date picker, as a Slovak date: `31. 10. 2026`. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

/** Today in the browser's time zone, as the date picker writes it. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
