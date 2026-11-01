import { sk } from '@intra/shared/i18n';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const t = sk.sharing.comments;

export interface CommentReply {
  id: string;
  body: string;
  authorName: string;
  createdAt: string | Date;
}

export interface CommentRow {
  id: string;
  body: string;
  authorName: string;
  createdAt: string | Date;
  anchor: { quote: string | null; tag: string | null } | null;
  replies: CommentReply[];
}

export const textareaClass = cn(inputClass, 'h-auto min-h-20 resize-y py-2 text-sm');

/** A short form under a comment: a reply, or the comment's new text. */
export function CommentForm({
  initial = '',
  placeholder,
  submit,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  submit: string;
  pending: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initial);
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) onSubmit(body.trim());
      }}
    >
      <textarea
        aria-label={placeholder}
        placeholder={placeholder}
        maxLength={4000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className={textareaClass}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * One comment with its replies, as the public page and a draft show it. Text anybody typed is only
 * ever text here. `children`: what the screen may do with it.
 */
export function CommentCard<T extends CommentRow>({
  comment,
  selected,
  name,
  onSelect,
  children,
}: {
  comment: T;
  selected?: boolean;
  /** The author's name as this screen says it („Ján (vy)“). */
  name?: string;
  onSelect?: () => void;
  children?: ReactNode;
}) {
  const quote = comment.anchor?.quote ?? (comment.anchor?.tag ? t.element : null);
  return (
    <article
      className={cn(
        'rounded-xl border p-3 text-sm leading-5',
        selected ? 'border-primary bg-primary-soft/40' : 'border-border-subtle',
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <span className="block text-xs text-muted">
          {name ?? comment.authorName} · {formatDateTime(comment.createdAt)}
        </span>
        {quote ? (
          <span className="mt-1 block text-xs">
            <span className="bg-[#fdf0c0]">„{quote}“</span>
          </span>
        ) : null}
        <span className="mt-1 block whitespace-pre-wrap">{comment.body}</span>
      </button>
      {comment.replies.map((reply) => (
        <p key={reply.id} className="mt-2 text-[13px] whitespace-pre-wrap">
          <span className="text-xs text-muted">
            {reply.authorName} · {formatDateTime(reply.createdAt)}
          </span>
          <br />
          {reply.body}
        </p>
      ))}
      {children}
    </article>
  );
}
