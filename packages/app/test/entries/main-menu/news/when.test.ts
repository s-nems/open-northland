import { describe, expect, it } from 'vitest';
import { formatCalendarDate, formatUntilStart } from '../../../../src/entries/main-menu/news/when.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

describe('news date labels', () => {
  it('counts minutes, hours, then calendar days to a start', () => {
    const now = new Date(2026, 10, 25, 12, 0).getTime();
    expect(formatUntilStart(now + 20 * MINUTE_MS, now, 'en')).toBe('in 20 minutes');
    expect(formatUntilStart(now + 5 * HOUR_MS, now, 'en')).toBe('in 5 hours');
    expect(formatUntilStart(new Date(2026, 10, 26, 19, 0).getTime(), now, 'en')).toBe('tomorrow');
    expect(formatUntilStart(new Date(2026, 10, 28, 9, 0).getTime(), now, 'pl')).toBe('za 3 dni');
  });

  it('writes a release date as its calendar day, read in UTC', () => {
    expect(formatCalendarDate('2026-11-14', 'en')).toBe('Nov 14, 2026');
  });
});
