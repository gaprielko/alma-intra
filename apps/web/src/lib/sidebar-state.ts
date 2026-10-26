import { useSyncExternalStore } from 'react';

/** Where the browser remembers the folded sidebar (per browser, never per user: it is a habit). */
export const SIDEBAR_STORAGE_KEY = 'intra.sidebar.collapsed';

function readStored(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    // No storage (private window, blocked site data, a server render): the sidebar starts open.
    return false;
  }
}

let collapsed = readStored();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => collapsed;

/** Folds the sidebar to its icon rail, or opens it again, and remembers the choice. */
export function toggleSidebar(): void {
  collapsed = !collapsed;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // The choice holds until the page is closed.
  }
  for (const listener of listeners) listener();
}

/** Whether the sidebar is folded to icons. UI state only. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
