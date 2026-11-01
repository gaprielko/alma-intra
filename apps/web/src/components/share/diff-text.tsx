import { sk } from '@intra/shared/i18n';
import { wordDiff } from '@/lib/word-diff';

export const ADDED_CLASS = 'bg-[#e4f3e0] text-[#14663a] underline underline-offset-2';
export const REMOVED_CLASS = 'bg-[#fce8e8] text-[#a11d24] line-through';

/** What changed in a fragment: added underlined in green, removed struck out in red. */
export function DiffText({ before, after }: { before: string; after: string }) {
  const parts = wordDiff(before, after);
  if (parts.length === 0) return <span className="text-muted">{sk.sharing.diff.none}</span>;
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.kind === 'same' ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === 'added' ? (
          <ins key={i} className={ADDED_CLASS}>
            {part.text}
          </ins>
        ) : (
          <del key={i} className={REMOVED_CLASS}>
            {part.text}
          </del>
        ),
      )}
    </span>
  );
}
