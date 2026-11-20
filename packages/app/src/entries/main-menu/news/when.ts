const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** An event's start in the player's zone: weekday, day, month, hour and minute. */
export function formatEventStart(startsAt: number, tag: string): string {
  return new Intl.DateTimeFormat(tag, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(startsAt);
}

function localMidnight(epochMs: number): number {
  const day = new Date(epochMs);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
}

/** How far off an upcoming start is ("in 20 minutes", "tomorrow"); counts calendar days past a day. */
export function formatUntilStart(startsAt: number, nowMs: number, tag: string): string {
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  const ahead = startsAt - nowMs;
  if (ahead < HOUR_MS) return relative.format(Math.max(1, Math.ceil(ahead / MINUTE_MS)), 'minute');
  if (ahead < DAY_MS) return relative.format(Math.round(ahead / HOUR_MS), 'hour');
  return relative.format(Math.round((localMidnight(startsAt) - localMidnight(nowMs)) / DAY_MS), 'day');
}

/** A `YYYY-MM-DD` calendar date as written in `tag`, read in UTC so no zone moves it a day. */
export function formatCalendarDate(date: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.parse(`${date}T00:00:00Z`));
}
