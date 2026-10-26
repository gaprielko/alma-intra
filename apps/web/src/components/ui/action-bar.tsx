import { sk } from '@intra/shared/i18n';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

/**
 * The state of the draft at the left of a form's action bar (ALMA-268, W22): „Koncept uložený
 * pred 10 s" with a green dot once „Uložiť rozpracované" went through (or „Zmeny uložené" for a
 * patient already admitted), „Neuložené zmeny" in warning (with the count, T5) while something is typed and not
 * saved, „Ukladám…" while a save runs, and the failure in danger until the next save succeeds.
 * The web has no autosave: the state only reports what the user did.
 */
export type DraftState =
  | { kind: 'saved'; at: Date; admitted?: boolean }
  /** T5: with the count of changed fields, „Neuložené zmeny · 2". */
  | { kind: 'unsaved'; count?: number | undefined }
  | { kind: 'saving' }
  | { kind: 'failed' };

/** „práve teraz", „pred 10 s", „pred 3 min", „pred 2 h": how long ago, in words, never rounded up. */
export function agoLabel(at: Date, now = new Date()): string {
  const a = sk.patientForm.draftState.ago;
  const seconds = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
  if (seconds < 5) return a.justNow;
  if (seconds < 60) return a.seconds(seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return a.minutes(minutes);
  return a.hours(Math.floor(minutes / 60));
}

function Draft({ state }: { state: DraftState }) {
  const d = sk.patientForm.draftState;
  // The clock of „pred … s" ticks while the state is a save in the past.
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.kind !== 'saved') return;
    const timer = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(timer);
  }, [state.kind]);
  const look = {
    saving: { dot: 'bg-tertiary', text: 'text-tertiary', role: 'status' as const },
    unsaved: { dot: 'bg-warning', text: 'text-[#8a4408]', role: 'status' as const },
    failed: { dot: 'bg-danger', text: 'text-danger', role: 'alert' as const },
    saved: { dot: 'bg-success', text: 'text-muted', role: 'status' as const },
  }[state.kind];
  const text =
    state.kind === 'saving'
      ? d.saving
      : state.kind === 'unsaved'
        ? state.count
          ? d.unsavedCount(state.count)
          : d.unsaved
        : state.kind === 'failed'
          ? d.failed
          : state.admitted
            ? d.changesSaved(agoLabel(state.at))
            : d.saved(agoLabel(state.at));
  return (
    <p className={cn('flex items-center gap-2 text-[13px]', look.text)} role={look.role}>
      <span aria-hidden className={cn('size-[7px] rounded-full', look.dot)} />
      {text}
    </p>
  );
}

/**
 * The action bar of a long form (ALMA-268, W22): 64 high, 12/24 padding, it stays at the bottom
 * of the window while the form is longer than it, and casts a shadow upwards only while there is
 * content under it. Left, the state of the draft; right, the actions („Uložiť rozpracované" ghost,
 * „Späť" secondary, the primary one last).
 */
export function ActionBar({
  draft,
  status,
  children,
  inset = true,
  className,
  gridSpan = false,
}: {
  draft?: DraftState | null | undefined;
  /** What stands at the left when it is not a draft's state (V1: „Označené 4 · …"). */
  status?: ReactNode;
  children: ReactNode;
  /** Inside a card with 24 px padding (the bar reaches its edges); `false` on a page. */
  inset?: boolean;
  className?: string | undefined;
  /**
   * A direct child of a two-column grid (a form laid out as one): the bar and its sentinel span
   * both columns, so the bar sticks over the whole form.
   */
  gridSpan?: boolean;
}) {
  // A sentinel right after the bar: while it is out of view, content is under the bar.
  const sentinel = useRef<HTMLDivElement>(null);
  const [covering, setCovering] = useState(false);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setCovering(!entry?.isIntersecting), {
      threshold: 0,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div
        className={cn(
          'sticky bottom-0 z-20 mt-6 flex min-h-16 flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-white px-6 py-3 transition-shadow duration-150',
          inset
            ? '-mx-6 -mb-6 rounded-b-2xl'
            : 'rounded-2xl border border-border-subtle shadow-rest',
          covering && 'shadow-bar',
          gridSpan && 'xl:col-span-2',
          className,
        )}
      >
        <div className="min-w-0">{draft ? <Draft state={draft} /> : status}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
      </div>
      <div
        ref={sentinel}
        aria-hidden
        className={cn('h-px w-full', gridSpan && '-mt-5 xl:col-span-2')}
      />
    </>
  );
}

/**
 * The reason a disabled primary action shows next to itself (ALMA-288 item 19): only while it is
 * disabled, and only when there is one. A primary that is merely busy (a save running) says
 * „Ukladám…“ on itself instead.
 */
export function shownDisabledReason(
  disabled: boolean | undefined,
  reason: string | null | undefined,
): string | null {
  return disabled && reason ? reason : null;
}

/**
 * The primary action of a screen, bar or dialog (ALMA-288 item 19): a disabled one never stands
 * there without saying why. The reason sits left of the button and is its description for a
 * screen reader.
 */
export function PrimaryAction({
  disabledReason,
  disabled,
  fullWidth = false,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  disabledReason?: string | null | undefined;
  /** The whole width of a side panel: the reason goes under the button instead. */
  fullWidth?: boolean;
}) {
  const reasonId = useId();
  const reason = shownDisabledReason(disabled ?? false, disabledReason);
  return (
    <span
      className={
        fullWidth
          ? 'flex w-full flex-col-reverse gap-1.5'
          : 'inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1'
      }
    >
      {reason ? (
        <span
          id={reasonId}
          className={cn('text-xs text-muted', fullWidth ? 'text-left' : 'max-w-xs text-right')}
        >
          {reason}
        </span>
      ) : null}
      <Button
        {...props}
        className={cn(fullWidth && 'w-full', className)}
        disabled={disabled}
        aria-describedby={reason ? reasonId : undefined}
      >
        {children}
      </Button>
    </span>
  );
}

/**
 * The flow's destructive action („Zahodiť“, „Ukončiť prenos“) on the left of the bar, on every
 * step, with its question first (ALMA-288 items 16 and 19). `onConfirm` may return a promise: the
 * question closes when it resolves and stays open (for another try) when it fails.
 */
export function DestructiveAction({
  label,
  confirm,
  onConfirm,
  pending = false,
  disabled = false,
}: {
  label: string;
  confirm: { title: string; description: string; confirmLabel: string };
  onConfirm: () => unknown;
  pending?: boolean;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        className="text-danger hover:bg-danger-soft"
        disabled={disabled || pending}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        pending={pending}
        onConfirm={() => {
          const result = onConfirm();
          if (result instanceof Promise) {
            result.then(
              () => setAsking(false),
              () => undefined,
            );
          }
        }}
      />
    </>
  );
}

/** „Späť“ (or „Späť na pacientov“ on a flow's first step) at the left end of the bar. */
export function BackAction({
  label = sk.common.back,
  onClick,
  disabled = false,
}: {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="secondary" disabled={disabled} onClick={onClick}>
      <ChevronLeft className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

/**
 * The one bottom bar of every multi-step flow (ALMA-288 item 19): new patient, patient edit, the
 * 753d migration, intake from a document, a new ADOS. Always the page's width, whatever the step
 * lays out above it. Left: „Späť“ and the flow's destructive action, then the draft's state.
 * Right: „Uložiť rozpracované“ where the flow keeps drafts, and the primary naming the next step
 * (a `PrimaryAction`, so a disabled one says why).
 */
export function FlowBar({
  back,
  destructive,
  draft,
  status,
  secondary,
  primary,
  className,
  gridSpan = false,
}: {
  back?: ReactNode;
  destructive?: ReactNode;
  draft?: DraftState | null | undefined;
  /** What stands left of the actions when it is not a draft's state. */
  status?: ReactNode;
  secondary?: ReactNode;
  primary: ReactNode;
  className?: string | undefined;
  /** See `ActionBar`: the bar is a direct child of a two-column grid. */
  gridSpan?: boolean;
}) {
  return (
    <ActionBar
      inset={false}
      gridSpan={gridSpan}
      className={className}
      status={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {back || destructive ? (
            <div className="flex flex-wrap items-center gap-2">
              {back}
              {destructive}
            </div>
          ) : null}
          {draft ? <Draft state={draft} /> : status}
        </div>
      }
    >
      {secondary}
      {primary}
    </ActionBar>
  );
}

/**
 * The save model of a detail page (ALMA-288 item 19): the fields are edited where they stand and
 * one sticky „Zrušiť · Uložiť zmeny“ bar saves them all. „Zrušiť“ asks before it throws changes
 * away. Used by the nurse detail and Nastavenia.
 */
export function SaveChangesBar({
  draft,
  dirty,
  saving,
  invalid = false,
  invalidReason,
  onDiscard,
  saveLabel = sk.common.saveChanges,
  discardText = sk.common.discardChanges.text,
  submit = true,
  onSave,
  inset = true,
  asking,
  onAskingChange,
}: {
  draft: DraftState | null;
  dirty: boolean;
  saving: boolean;
  /** A field is wrong and says so under itself: nothing to save until it is right. */
  invalid?: boolean;
  invalidReason?: string | undefined;
  onDiscard: () => void;
  saveLabel?: string;
  discardText?: string;
  /** The save is the surrounding form's submit; `false` with `onSave` for a bar outside one. */
  submit?: boolean;
  onSave?: () => void;
  inset?: boolean;
  /** The discard question, controlled from outside (the nurse detail opens it on Esc too). */
  asking?: boolean;
  onAskingChange?: (asking: boolean) => void;
}) {
  const [ownAsking, setOwnAsking] = useState(false);
  const discarding = asking ?? ownAsking;
  const setDiscarding = onAskingChange ?? setOwnAsking;
  const d = sk.common.discardChanges;
  return (
    <>
      <ActionBar draft={draft} inset={inset}>
        <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDiscarding(true)}>
          {sk.common.cancel}
        </Button>
        <PrimaryAction
          type={submit ? 'submit' : 'button'}
          onClick={submit ? undefined : onSave}
          disabled={!dirty || saving || invalid}
          disabledReason={dirty && invalid ? (invalidReason ?? d.invalid) : null}
        >
          {saving ? sk.common.saving : saveLabel}
        </PrimaryAction>
      </ActionBar>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={d.title}
        description={discardText}
        confirmLabel={d.confirm}
        cancelLabel={d.stay}
        onConfirm={() => {
          setDiscarding(false);
          onDiscard();
        }}
      />
    </>
  );
}
