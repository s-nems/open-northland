import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SPEED_CONTROL } from '../../src/hud/tool-panel/game-speed.js';
import { clockAnnouncement, speedControlFor } from '../../src/view/net/session-clock.js';

const clock = (speed: number, paused: boolean, by: string | null) =>
  ({ kind: 'clock', tick: 10, speed, paused, by }) as const;

describe('speedControlFor', () => {
  it('maps the button multipliers and keeps the running state for any other', () => {
    expect(speedControlFor(clock(2, false, null), DEFAULT_GAME_SPEED_CONTROL)).toEqual({
      running: 'fast',
      paused: false,
    });
    expect(speedControlFor(clock(3, true, null), DEFAULT_GAME_SPEED_CONTROL)).toEqual({
      running: 'faster',
      paused: true,
    });
    expect(speedControlFor(clock(0.5, false, null), { running: 'fast', paused: true })).toEqual({
      running: 'fast',
      paused: false,
    });
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
