import { localNow } from './next-step-reminder.js';

describe('next step reminders', () => {
  it('reads the date and hour in Slovakia, across midnight and daylight saving', () => {
    // Winter time (UTC+1): 23:30 UTC is already the next day.
    expect(localNow(new Date('2026-10-28T23:30:00Z'))).toEqual({ date: '2026-10-29', hour: 0 });
    // Summer time (UTC+2).
    expect(localNow(new Date('2026-07-01T05:00:00Z'))).toEqual({ date: '2026-07-01', hour: 7 });
  });
});
