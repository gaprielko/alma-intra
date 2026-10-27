import { sk } from '@intra/shared/i18n';
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ErrorState } from '@/components/empty-state';
import { errorMessage } from '@/lib/errors';

/** A lazy route of an older build: the tab outlived a deploy and the chunk is gone. */
const isStaleChunk = (error: unknown) =>
  error instanceof Error &&
  /dynamically imported module|Importing a module script failed/i.test(error.message);

const RELOADED_KEY = 'intra:reloaded-for-new-build';

/** What a route shows when its loader, guard or render throws; the message never quotes the error. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  // Once per tab: load the new build instead of failing the navigation.
  useEffect(() => {
    if (!isStaleChunk(error)) return;
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return;
      sessionStorage.setItem(RELOADED_KEY, '1');
    } catch {
      return;
    }
    window.location.reload();
  }, [error]);
  return (
    <div className="flex min-h-64 flex-col items-center justify-center p-10">
      <ErrorState
        title={sk.errors.pageTitle}
        text={errorMessage(error)}
        onRetry={() => {
          reset();
          void router.invalidate();
        }}
      />
    </div>
  );
}
