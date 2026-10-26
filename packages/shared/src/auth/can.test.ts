import { describe, expect, it } from 'vitest';
import { ACTIONS, can } from './can.js';
import type { Actor } from './roles.js';

const jana: Actor = { userId: '00000000-0000-4000-8000-000000000001', role: 'admin' };
const peter = '00000000-0000-4000-8000-000000000002';

describe('can()', () => {
  it('lets an admin do everything to somebody else', () => {
    for (const action of ACTIONS) expect(can(jana, action, { userId: peter }), action).toBe(true);
  });

  it('lets nobody deactivate herself or reset her own second factor', () => {
    expect(can(jana, 'user.deactivate', { userId: jana.userId })).toBe(false);
    expect(can(jana, 'user.reset_second_factor', { userId: jana.userId })).toBe(false);
  });

  it('lets her edit her own details and read the list', () => {
    expect(can(jana, 'user.update', { userId: jana.userId })).toBe(true);
    expect(can(jana, 'user.read')).toBe(true);
  });
});
