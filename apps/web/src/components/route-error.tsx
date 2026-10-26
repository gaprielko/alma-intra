import { sk } from '@intra/shared/i18n';
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ErrorState } from '@/components/empty-state';
import { PageSkeleton } from '@/components/skeletons';
import { errorMessage } from '@/lib/errors';
import {
  isStaleChunkError,
  reloadOnceForNewBuild,
  replacedByNewBuild,
  sessionStore,
} from '@/lib/stale-build';

/** What a route shows when its loader, guard or render throws; the message never quotes the error. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  // A lazy route of an older build (the tab outlived a deploy): load the new build instead.
  useEffect(() => {
    if (isStaleChunkError(error))
      reloadOnceForNewBuild(sessionStore(), () => window.location.reload());
  }, [error]);
  // Nothing failed that the reload will not cure: the screen is loading, in grey (ALMA-288 item 64).
  if (replacedByNewBuild(error, sessionStore())) return <PageSkeleton />;
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
