import { sk } from '@intra/shared/i18n';
import { datedFilename } from './download';
import { formatDate, formatDateTime, formatRecent, nameInitials } from './format';

describe('format', () => {
  it('writes dates the Slovak way', () => {
    const at = new Date(2026, 9, 7, 9, 5);
    expect(formatDate(at)).toBe('7. 10. 2026');
    expect(formatDateTime(at)).toBe('7. 10. 2026 9:05');
  });

  it('says today and yesterday, else the date', () => {
    const now = new Date();
    now.setHours(9, 12, 0, 0);
    expect(formatRecent(now)).toBe(`${sk.common.today} 9:12`);
    const yesterday = new Date(now.getTime() - 86_400_000);
    expect(formatRecent(yesterday)).toBe(`${sk.common.yesterday} 9:12`);
    expect(formatRecent(new Date(2020, 0, 2))).toBe('2. 1. 2020');
  });

  it('takes initials from the first and the last word', () => {
    expect(nameInitials('Jana Horváthová')).toBe('JH');
    expect(nameInitials('Mgr. Eva Tóthová')).toBe('MT');
    expect(nameInitials('  eva ')).toBe('E');
  });

  it('dates exported files', () => {
    expect(datedFilename('kontakty', 'csv', new Date(2026, 9, 7))).toBe('kontakty-2026-10-07.csv');
  });
});
