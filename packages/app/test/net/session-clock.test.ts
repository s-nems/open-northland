import { describe, expect, it } from 'vitest';
import { clockAnnouncement, speedControlFor } from '../../src/view/net/session-clock.js';

/** Any tick: the announcements read the speed and the pause alone. */
const CLOCK_TICK = 10;
const clock = (speed: number, paused: boolean, by: string | null) =>
  ({ kind: 'clock', tick: CLOCK_TICK, speed, paused, by, governed: null }) as const;

describe('speedControlFor', () => {
  const at = (requestedSpeed: number, paused = false) => speedControlFor({ requestedSpeed, paused });

  it('stands at the requested preset, whatever speed a governed room runs at', () => {
    expect(at(1)).toEqual({ running: 'normal', paused: false });
    expect(at(2)).toEqual({ running: 'fast', paused: false });
    expect(at(3, true)).toEqual({ running: 'faster', paused: true });
  });

  it('stands at ×1 below it, and at the top segment above the top preset', () => {
    expect(at(0.25)).toEqual({ running: 'normal', paused: false });
    expect(at(5)).toEqual({ running: 'faster', paused: false });
  });
});

describe('clockAnnouncement', () => {
  it('names who paused, resumed or changed the speed, and stays quiet for the relay’s own notices', () => {
    expect(clockAnnouncement(null, clock(1, false, null))).toBeNull();
    expect(clockAnnouncement(clock(1, false, null), clock(1, true, 'Ania'))).toContain('Ania');
    expect(clockAnnouncement(clock(1, true, 'Ania'), clock(1, false, 'Bartek'))).toContain('Bartek');
    expect(clockAnnouncement(clock(1, false, null), clock(2, false, 'Ania'))).toContain('2');
    expect(clockAnnouncement(clock(2, false, 'Ania'), clock(2, false, 'Ania'))).toBeNull();
  });
});
