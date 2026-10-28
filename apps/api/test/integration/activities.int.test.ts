import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_USERS } from '../../src/db/seed.js';
import { browser, JANA, startApi } from './client.js';

const HARMONIA = '00000000-0000-4000-8000-d00000000001';
const EVA = '00000000-0000-4000-8000-e00000000010';
/** A contact person of another organization (ADOS Medicare Žilina). */
const OTHER = '00000000-0000-4000-8000-e00000000020';
const text = (value: string, marks?: unknown) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: value, ...(marks ? { marks } : {}) }] },
  ],
});

describe('activities', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;

  beforeAll(async () => {
    api = await startApi();
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
  });
  afterAll(async () => {
    await api.close();
  });

  const activity = (extra: Record<string, unknown> = {}) => ({
    customerId: HARMONIA,
    activity: {
      kind: 'call',
      occurredAt: new Date().toISOString(),
      subject: 'Telefonát',
      ...extra,
    },
  });

  it('records a call with a next step that shows in „Moje ďalšie kroky“ until done', async () => {
    const made = await jana.call<{ id: string }>(
      'activity.create',
      activity({
        contactIds: [EVA],
        body: text('Dohodnutá ponuka.'),
        nextStep: { text: 'Poslať ponuku', assigneeId: SEED_USERS.jana },
      }),
    );
    expect(made.code).toBeUndefined();
    const steps = await jana.call<{ id: string; text: string }[]>('activity.myNextSteps');
    expect(steps.data.some((s) => s.id === made.data.id)).toBe(true);
    await jana.call('activity.setNextStepDone', { id: made.data.id, done: true });
    const after = await jana.call<{ id: string }[]>('activity.myNextSteps');
    expect(after.data.some((s) => s.id === made.data.id)).toBe(false);
  });

  it('refuses a javascript: link in the notes and a person of another contact', async () => {
    const link = text('klik', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]);
    expect((await jana.call('activity.create', activity({ body: link }))).code).toBe('BAD_REQUEST');
    const foreign = await jana.call('activity.create', activity({ contactIds: [OTHER] }));
    expect(foreign.code).toBe('BAD_REQUEST');
  });

  it('shows on the contact timeline, newest first', async () => {
    const timeline = await jana.call<{ type: string; at: string }[]>('activity.timeline', {
      customerId: HARMONIA,
      filter: 'activities',
    });
    expect(timeline.data.length).toBeGreaterThan(0);
    const times = timeline.data.map((item) => new Date(item.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
