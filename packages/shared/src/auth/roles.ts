/**
 * The roles of Alma Intra. One for now: everybody who works in it may do everything, managing the
 * other users included. A second role is a new value here, its rules in `can()` and a migration
 * of the `user_role` enum.
 */
export const ROLES = ['admin'] as const;
export type Role = (typeof ROLES)[number];

/** Who is acting: the session's user and her role. */
export interface Actor {
  userId: string;
  role: Role;
}
