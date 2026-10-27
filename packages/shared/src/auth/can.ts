import type { Actor, Role } from './roles.js';

export const ACTIONS = [
  // The other users: the list, inviting, editing their details, deactivating and reactivating,
  // and taking away a second factor for somebody who lost her phone.
  'user.read',
  'user.invite',
  'user.update',
  'user.deactivate',
  'user.reactivate',
  'user.reset_second_factor',
  // Customers and their contacts: reading, creating and editing, the soft delete, the CSV export.
  'customer.read',
  'customer.write',
  'customer.delete',
  'customer.export',
  // Settings › Číselníky: customer types, sources and tags.
  'code_list.manage',
  // Files: reading and downloading; uploading, versions, folders, renaming and moving; the trash.
  'file.read',
  'file.write',
  'file.delete',
  // Activities: calls, meetings and notes with a customer; anyone may edit one, and every edit is
  // audited.
  'activity.read',
  'activity.write',
  'activity.delete',
  // E-mail templates (reading them is part of sending), and Settings › Vzhľad e-mailov.
  'template.read',
  'template.write',
  'email_look.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

/** The row an action is about, when it is about one. */
export interface Resource {
  /** The user the action is about (`user.*`). */
  userId?: string;
}

/** Which roles may perform each action at all; the rules below may narrow it further. */
const POLICY: Record<Action, readonly Role[]> = {
  'user.read': ['admin'],
  'user.invite': ['admin'],
  'user.update': ['admin'],
  'user.deactivate': ['admin'],
  'user.reactivate': ['admin'],
  'user.reset_second_factor': ['admin'],
  'customer.read': ['admin'],
  'customer.write': ['admin'],
  'customer.delete': ['admin'],
  'customer.export': ['admin'],
  'code_list.manage': ['admin'],
  'file.read': ['admin'],
  'file.write': ['admin'],
  'file.delete': ['admin'],
  'activity.read': ['admin'],
  'activity.write': ['admin'],
  'activity.delete': ['admin'],
  'template.read': ['admin'],
  'template.write': ['admin'],
  'email_look.manage': ['admin'],
};

/**
 * The one authorization decision of the app, used by the API's procedures and by the web to hide
 * what would be refused. No procedure or component checks a role by itself.
 *
 * Nobody deactivates or resets herself: deactivating herself would lock her out, and her own
 * second factor is moved on „Môj účet“, with her password and a code.
 */
export function can(actor: Actor, action: Action, resource: Resource = {}): boolean {
  if (!POLICY[action].includes(actor.role)) return false;
  const self = resource.userId !== undefined && resource.userId === actor.userId;
  if ((action === 'user.deactivate' || action === 'user.reset_second_factor') && self) {
    return false;
  }
  return true;
}
