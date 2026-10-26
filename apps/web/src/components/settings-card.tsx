import { sk } from '@intra/shared/i18n';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { ActionBar } from '@/components/ui/action-bar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';

const t = sk.settings;

/**
 * One card of Nastavenia or Môj účet (ALMA-248, Figma HS-N1 v2): it reads until „Upraviť“, and
 * saves or drops its own changes with its own buttons. No save in the page header that leaves her
 * guessing which fields it covers (ALMA-251 item 37). Its own form, so Enter saves this card.
 */
export function SettingsCard({
  title,
  note,
  editing,
  saving = false,
  onEdit,
  onCancel,
  onSave,
  saveLabel = t.save,
  dirtyCount,
  invalid = false,
  children,
}: {
  title: string;
  note?: ReactNode;
  editing: boolean;
  saving?: boolean;
  /** Left out where the card has no view mode to leave (the password) or may not be changed. */
  onEdit?: (() => void) | undefined;
  onCancel?: () => void;
  onSave?: () => void;
  saveLabel?: string;
  /** S3 (ALMA-275): how many fields changed, said in the sticky bar while the card is edited. */
  dirtyCount?: number | undefined;
  /** A field of the card is wrong and says so under itself: nothing to save until it is right. */
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSave?.();
        }}
      >
        <CardHeader
          title={title}
          action={
            onEdit && !editing ? (
              <Button variant="ghost" aria-label={`${t.edit} · ${title}`} onClick={onEdit}>
                {t.edit}
              </Button>
            ) : null
          }
        />
        <fieldset disabled={saving} className="contents">
          <div className={editing && onSave ? 'p-6' : 'p-5'}>
            {children}
            {/* The note stays readable above the bar while the card is edited. */}
            {editing && onSave && note ? (
              <p className="mt-5 border-t border-border-subtle pt-3 text-xs text-muted">{note}</p>
            ) : null}
            {/* S3 (ALMA-275): the W22 bar while the card is edited, hidden while it reads. */}
            {editing && onSave ? (
              <ActionBar
                draft={
                  saving
                    ? { kind: 'saving' }
                    : dirtyCount
                      ? { kind: 'unsaved', count: dirtyCount }
                      : null
                }
              >
                {onCancel ? (
                  <Button variant="ghost" onClick={onCancel}>
                    {sk.common.cancel}
                  </Button>
                ) : null}
                <Button type="submit" disabled={saving || dirtyCount === 0 || invalid}>
                  {saving ? t.saving : saveLabel}
                </Button>
              </ActionBar>
            ) : null}
          </div>
        </fieldset>
        {note && !(editing && onSave) ? (
          <p className="border-t border-border-subtle px-5 py-3 text-xs text-muted">{note}</p>
        ) : null}
      </form>
    </Card>
  );
}

export const fieldError = (message: string | undefined, id?: string) =>
  message ? (
    <p id={id} className="mt-1 text-xs text-danger">
      {sk.validation[message as keyof typeof sk.validation] ?? sk.validation.invalid}
    </p>
  ) : null;

export const requiredError = (id: string) => (
  <p id={id} className="mt-1 flex items-center gap-1 text-xs text-danger">
    <TriangleAlert className="size-3.5" aria-hidden />
    {t.required}
  </p>
);
