import { type Action, type Actor, can, type Resource, type Role } from '@intra/shared/auth';
import { create } from 'zustand';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  position: string | null;
  role: Role;
}

interface SessionState {
  user: SessionUser | null;
  /** Who `can()` is asked about; `null` while logged out. */
  actor: Actor | null;
  setSession: (user: SessionUser) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  actor: null,
  setSession: (user) => set({ user, actor: { userId: user.id, role: user.role } }),
  clear: () => set({ user: null, actor: null }),
}));

/**
 * UI-side twin of the API guard: the same `can()` decides what is shown and what is allowed.
 * Hiding an action is a convenience only: the server checks again.
 */
export function useCan(action: Action, resource?: Resource): boolean {
  const actor = useSession((state) => state.actor);
  return actor ? can(actor, action, resource) : false;
}

/** The same question outside React (a route's `beforeLoad`). */
export function sessionCan(action: Action, resource?: Resource): boolean {
  const actor = useSession.getState().actor;
  return actor ? can(actor, action, resource) : false;
}

/** Where a signed-in user lands. */
export const HOME_PATH = '/overview';
