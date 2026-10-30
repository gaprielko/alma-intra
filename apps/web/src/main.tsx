import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotFound } from './components/not-found';
import { RouteError } from './components/route-error';
import { trackPreviousLocation } from './lib/previous-location';
import { queryClient } from './lib/trpc';
import { routeTree } from './routeTree.gen';
import './styles.css';

// A page that throws is replaced inside its shell; the layouts carry the same component for
// their own failures.
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultErrorComponent: RouteError,
  // An address no route matches: the Slovak page instead of the router's bare „Not Found“.
  defaultNotFoundComponent: NotFound,
});

// Where the user came from, for the „Späť“ of a screen opened from elsewhere than its own list.
trackPreviousLocation(router);

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
