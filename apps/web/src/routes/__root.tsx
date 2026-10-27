import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { RouteError } from '@/components/route-error';
import { ToastProvider } from '@/components/ui/toast';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Toasts for every screen: every mutation reports how it went.
  component: () => (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  ),
  errorComponent: RouteError,
});
