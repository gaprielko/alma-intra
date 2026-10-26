import { avatarColorOf } from '@/lib/avatar-color';
import { nameInitials } from '@/lib/format';
import { cn } from '@/lib/utils';

/** W26: the sizes of an avatar and the initials that fit each. */
const SIZES = {
  24: { box: 'size-6', text: 'text-[9px]' },
  28: { box: 'size-7', text: 'text-[10px]' },
  32: { box: 'size-8', text: 'text-[11px]' },
  40: { box: 'size-10', text: 'text-[13px]' },
  64: { box: 'size-16', text: 'text-[20px]' },
} as const;

/**
 * A person as a circle of initials on the colour her name keeps (ALMA-268, W26), or her photo if
 * there is one. Decorative when the name stands next to it; else `label` names her.
 */
export function Avatar({
  name,
  photoUrl,
  size = 32,
  label,
  online = false,
  className,
}: {
  name: string;
  photoUrl?: string | null | undefined;
  size?: keyof typeof SIZES;
  label?: string | undefined;
  /** W26: the 11 px green dot with its white ring, bottom right. */
  online?: boolean;
  className?: string | undefined;
}) {
  const { box, text } = SIZES[size];
  const color = avatarColorOf(name);
  return (
    <span
      className={cn('relative inline-flex shrink-0', box, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {photoUrl ? (
        <img src={photoUrl} alt="" className={cn('rounded-full object-cover', box)} />
      ) : (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full font-semibold',
            box,
            text,
          )}
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {nameInitials(name)}
        </span>
      )}
      {online ? (
        <span className="absolute -right-px -bottom-px size-[11px] rounded-full bg-success ring-2 ring-white" />
      ) : null}
    </span>
  );
}
