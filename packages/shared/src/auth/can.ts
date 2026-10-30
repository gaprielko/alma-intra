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
  // audited. The same actions cover the list in Aktivity (docs/activities.md).
  'activity.read',
  'activity.write',
  'activity.delete',
  // The code list of Aktivity's types (docs/activity-types.md).
  'activity_type.read',
  'activity_type.write',
  // E-mail templates (reading them is part of sending), and Settings › Vzhľad e-mailov.
  'template.read',
  'template.write',
  'email_look.manage',
  // E-mails to customers: the sent ones and their delivery; composing and sending.
  'email.read',
  'email.send',
  // Nastavenia › Záznam aktivít: who did what, the whole app's audit trail (D-16).
  'audit.read',
  // Produkty (docs/products.md): the products, their price lists and the shared items; the VAT rate.
  'product.read',
  'product.write',
  'pricing.manage',
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
  'activity_type.read': ['admin'],
  'activity_type.write': ['admin'],
  'template.read': ['admin'],
  'template.write': ['admin'],
  'email_look.manage': ['admin'],
  'email.read': ['admin'],
  'email.send': ['admin'],
  'audit.read': ['admin'],
  'product.read': ['admin'],
  'product.write': ['admin'],
  'pricing.manage': ['admin'],
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
