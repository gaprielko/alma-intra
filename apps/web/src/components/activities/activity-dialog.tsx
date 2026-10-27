import { sk } from '@intra/shared/i18n';
import { ACTIVITY_KINDS, type ActivityKind, type RichText } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { KIND_ICON, KIND_CLASS, todayIso } from '@/components/activities/activity-bits';
import { FileBadge } from '@/components/files/file-bits';
import { FilePicker, type PickedFile } from '@/components/files/file-picker';
import { RichTextEditor } from '@/components/rich-text';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatSize } from '@/lib/files';
import { useSession } from '@/lib/session';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.activities;
const d = t.dialog;
type Activity = RouterOutputs['activity']['get'];

const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 180, 240];

interface Person {
  kind: 'contact' | 'user';
  id: string;
  name: string;
}

interface Attachment {
  fileId: string;
  versionId?: string | undefined;
  name: string;
  size: number;
  version: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const timeOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const initials = (name: string) =>
  name
    .replace(/^(\p{Lu}\p{Ll}*\.\s*)+/u, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

/**
 * „Zapísať aktivitu“ and its edit: the kind, subject, when and how long, who took part, the notes,
 * attachments and an optional next step (D-23).
 */
export function ActivityDialog({
  customerId,
  customerName,
  activity,
  initialKind = 'meeting',
  onClose,
  onSaved,
}: {
  customerId: string;
  customerName: string;
  /** Edit this one; without it, a new activity. */
  activity?: Activity;
  initialKind?: ActivityKind;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useSession((state) => state.user);
  const options = useQuery(trpc.activity.options.queryOptions({ id: customerId }));
  const ids = useId();
  const startedAt = activity ? new Date(activity.occurredAt) : new Date();

  const [kind, setKind] = useState<ActivityKind>(activity?.kind ?? initialKind);
  const [subject, setSubject] = useState(activity?.subject ?? '');
  const [date, setDate] = useState(todayIso(startedAt));
  const [time, setTime] = useState(timeOf(startedAt));
  const [duration, setDuration] = useState(
    activity?.durationMin ? String(activity.durationMin) : '',
  );
  const [people, setPeople] = useState<Person[]>(
    activity?.participants ??
      (me && initialKind !== 'note' ? [{ kind: 'user', id: me.id, name: me.name }] : []),
  );
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [body, setBody] = useState<RichText | null>((activity?.body as RichText | null) ?? null);
  const [attachments, setAttachments] = useState<Attachment[]>(
    activity?.attachments.map((a) => ({
      fileId: a.fileId,
      versionId: a.versionId,
      name: a.name,
      size: a.size,
      version: a.number ?? 1,
    })) ?? [],
  );
  const [picking, setPicking] = useState(false);
  const [hasNext, setHasNext] = useState(Boolean(activity?.nextStepText));
  const [nextText, setNextText] = useState(activity?.nextStepText ?? '');
  const [nextDue, setNextDue] = useState(activity?.nextStepDue ?? '');
  const [nextWho, setNextWho] = useState(activity?.nextStepUserId ?? me?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const chosen = new Set(people.map((p) => `${p.kind}:${p.id}`));
    const needle = query.trim().toLocaleLowerCase('sk');
    const all: Person[] = [
      ...(options.data?.contacts ?? []).map((c) => ({
        kind: 'contact' as const,
        id: c.id,
        name: c.name,
      })),
      ...(options.data?.users ?? []).map((u) => ({
        kind: 'user' as const,
        id: u.id,
        name: u.name,
      })),
    ];
    return all.filter(
      (p) =>
        !chosen.has(`${p.kind}:${p.id}`) &&
        (!needle || p.name.toLocaleLowerCase('sk').includes(needle)),
    );
  }, [options.data, people, query]);

  const onDone = async (id: string) => {
    toast('success', d.saved);
    await Promise.all([
      queryClient.invalidateQueries(trpc.activity.pathFilter()),
      queryClient.invalidateQueries(trpc.customer.list.pathFilter()),
      queryClient.invalidateQueries(trpc.file.pathFilter()),
    ]);
    onSaved?.(id);
    onClose();
  };
  const onFail = (failure: unknown) =>
    setError(errorMessage(failure, { ...t.errors, ...sk.validation }));
  const create = useMutation(
    trpc.activity.create.mutationOptions({ onSuccess: (r) => onDone(r.id), onError: onFail }),
  );
  const update = useMutation(
    trpc.activity.update.mutationOptions({
      onSuccess: () => onDone(activity!.id),
      onError: onFail,
    }),
  );
  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (!subject.trim() && !body) {
      setError(d.required);
      return;
    }
    if (hasNext && !nextText.trim()) {
      setError(sk.validation.required);
      return;
    }
    setError(null);
    const values = {
      kind,
      occurredAt: new Date(`${date}T${time || '00:00'}`),
      ...(duration ? { durationMin: Number(duration) } : {}),
      ...(subject.trim() ? { subject: subject.trim() } : {}),
      ...(body ? { body } : {}),
      contactIds: people.filter((p) => p.kind === 'contact').map((p) => p.id),
      userIds: people.filter((p) => p.kind === 'user').map((p) => p.id),
      attachments: attachments.map((a) => ({
        fileId: a.fileId,
        ...(a.versionId ? { versionId: a.versionId } : {}),
      })),
      nextStep: hasNext
        ? {
            text: nextText.trim(),
            ...(nextDue ? { due: nextDue } : {}),
            ...(nextWho ? { assigneeId: nextWho } : {}),
          }
        : null,
    };
    if (activity) update.mutate({ id: activity.id, activity: values });
    else create.mutate({ customerId, activity: values });
  };

  const addPicked = (picked: PickedFile[]) =>
    setAttachments((current) => [
      ...current,
      ...picked.filter((p) => !current.some((a) => a.fileId === p.fileId)),
    ]);

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
        <DialogContent className="max-w-[42.5rem]">
          <DialogHeader>
            <DialogTitle>{activity ? d.editTitle : d.newTitle}</DialogTitle>
            <DialogDescription>{customerName}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-[18px]"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div role="radiogroup" aria-label={d.kindLabel} className="flex flex-wrap gap-2.5">
              {ACTIVITY_KINDS.map((value) => {
                const Icon = KIND_ICON[value];
                const on = value === kind;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setKind(value)}
                    className={cn(
                      'inline-flex h-11 items-center gap-2.5 rounded-xl border px-3.5 pl-2 text-sm font-semibold transition-colors',
                      on
                        ? 'border-primary bg-[#f0f8f7] text-primary-text shadow-[inset_0_0_0_1px_var(--color-primary)]'
                        : 'border-border bg-white hover:bg-hover',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-7 items-center justify-center rounded-lg',
                        KIND_CLASS[value],
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    {t.kinds[value]}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-6 space-y-2">
                <Label htmlFor={`${ids}-subject`}>{d.subject}</Label>
                <Input
                  id={`${ids}-subject`}
                  maxLength={200}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </div>
              <div className="col-span-6 space-y-2 sm:col-span-2">
                <Label htmlFor={`${ids}-date`}>{d.date}</Label>
                <Input
                  id={`${ids}-date`}
                  type="date"
                  required
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="col-span-3 space-y-2 sm:col-span-2">
                <Label htmlFor={`${ids}-time`}>{d.time}</Label>
                <Input
                  id={`${ids}-time`}
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>
              <div className="col-span-3 space-y-2 sm:col-span-2">
                <Label htmlFor={`${ids}-duration`}>{t.duration.label}</Label>
                <Select id={`${ids}-duration`} value={duration} onChange={setDuration}>
                  <SelectItem value="">{t.duration.none}</SelectItem>
                  {DURATIONS.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {t.duration.format(minutes)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <p id={`${ids}-people`} className="text-sm font-medium">
                {d.participants}
              </p>
              <div className="relative">
                <div
                  className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-border px-2.5 py-2 focus-within:border-primary"
                  aria-labelledby={`${ids}-people`}
                >
                  {people.map((person) => (
                    <span
                      key={`${person.kind}:${person.id}`}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-full pr-1 pl-1 text-[13px] font-semibold',
                        person.kind === 'user'
                          ? 'bg-[#dde6e3] text-muted'
                          : 'bg-primary-soft text-primary-text',
                      )}
                    >
                      <i
                        aria-hidden
                        className="inline-flex size-5 items-center justify-center rounded-full bg-white/70 text-[9px] font-bold not-italic"
                      >
                        {initials(person.name)}
                      </i>
                      {person.name}
                      <button
                        type="button"
                        aria-label={d.removeParticipant(person.name)}
                        onClick={() => setPeople((list) => list.filter((p) => p !== person))}
                        className="inline-flex size-5 items-center justify-center rounded-full hover:bg-white/60"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                  <input
                    aria-label={d.addParticipant}
                    placeholder={d.addParticipant}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setListOpen(true);
                    }}
                    onFocus={() => setListOpen(true)}
                    onBlur={() => setTimeout(() => setListOpen(false), 150)}
                    className="h-7 min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-tertiary"
                  />
                </div>
                {listOpen ? (
                  <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border-subtle bg-white p-1 shadow-floating">
                    {candidates.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-muted">{d.noMatch}</li>
                    ) : (
                      candidates.map((person) => (
                        <li key={`${person.kind}:${person.id}`}>
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setPeople((list) => [...list, person]);
                              setQuery('');
                              // Closed after a pick: open, it would cover the notes below.
                              setListOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover"
                          >
                            <span className="truncate">{person.name}</span>
                            <span className="shrink-0 text-xs text-muted">
                              {person.kind === 'contact' ? d.contactsGroup : d.usersGroup}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <p id={`${ids}-notes`} className="text-sm font-medium">
                {d.notes}
              </p>
              <RichTextEditor value={body} onChange={setBody} labelledBy={`${ids}-notes`} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{d.attachments}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(true)}>
                  <Paperclip className="size-3.5" aria-hidden />
                  {d.attach}
                </Button>
              </div>
              {attachments.length > 0 ? (
                <ul className="space-y-1.5">
                  {attachments.map((file) => (
                    <li
                      key={file.fileId}
                      className="flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2"
                    >
                      <FileBadge name={file.name} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {file.name}{' '}
                        <span className="font-medium text-muted">
                          · {d.attachmentMeta(file.version, formatSize(file.size))}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={d.removeAttachment(file.name)}
                        onClick={() =>
                          setAttachments((list) => list.filter((a) => a.fileId !== file.fileId))
                        }
                        className="rounded-md p-1 text-muted hover:bg-hover"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="rounded-[14px] border border-border-subtle bg-surface p-3.5">
              <div className="flex items-center gap-3">
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{d.nextStep}</span>
                  <span className="block text-[13px] text-muted">{d.nextStepHint}</span>
                </span>
                <Switch
                  checked={hasNext}
                  label={d.nextStep}
                  onChange={() => setHasNext((v) => !v)}
                />
              </div>
              {hasNext ? (
                <div className="mt-3 grid grid-cols-6 gap-3">
                  <div className="col-span-6 space-y-2">
                    <Label htmlFor={`${ids}-next`}>{d.nextStepText}</Label>
                    <Input
                      id={`${ids}-next`}
                      maxLength={300}
                      value={nextText}
                      onChange={(event) => setNextText(event.target.value)}
                    />
                  </div>
                  <div className="col-span-6 space-y-2 sm:col-span-3">
                    <Label htmlFor={`${ids}-due`}>{d.nextStepDue}</Label>
                    <Input
                      id={`${ids}-due`}
                      type="date"
                      value={nextDue}
                      onChange={(event) => setNextDue(event.target.value)}
                    />
                  </div>
                  <div className="col-span-6 space-y-2 sm:col-span-3">
                    <Label htmlFor={`${ids}-who`}>{d.nextStepWho}</Label>
                    <Select id={`${ids}-who`} value={nextWho} onChange={setNextWho}>
                      <SelectItem value="">{d.nobody}</SelectItem>
                      {(options.data?.users ?? []).map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>

            {error ? (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                {sk.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {d.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {picking ? (
        <FilePicker
          customerId={customerId}
          customerName={customerName}
          already={new Set(attachments.map((a) => a.fileId))}
          onClose={() => setPicking(false)}
          onPick={addPicked}
        />
      ) : null}
    </>
  );
}
