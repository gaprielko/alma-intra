import { sk } from '@intra/shared/i18n';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { restoreSession } from '@/lib/auth';
import { HOME_PATH, useSession } from '@/lib/session';

/** An address no route matches, in Slovak and in the look of an empty screen. */
export function NotFound() {
  const actor = useSession((s) => s.actor);
  // A signed-in user in a new tab has no session in the store yet: ask the API once, quickly.
  const [checked, setChecked] = useState(actor !== null);
  useEffect(() => {
    if (checked) return;
    void restoreSession({ quick: true }).finally(() => setChecked(true));
  }, [checked]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        title={sk.errors.notFound.title}
        text={sk.errors.notFound.text}
        action={
          checked ? (
            <Button asChild>
              <Link to={actor ? HOME_PATH : '/login'}>
                {actor ? sk.errors.notFound.home : sk.auth.login}
              </Link>
            </Button>
          ) : null
        }
      />
    </div>
  );
}
