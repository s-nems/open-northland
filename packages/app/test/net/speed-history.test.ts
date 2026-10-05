import { TICKS_PER_SECOND } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { SPEED_HISTORY_SECONDS } from '../../src/hud/network/model.js';
import { createSpeedHistory } from '../../src/view/net/speed-history.js';

const FRAME_MS = 16;
const SECOND_MS = 1000;

/** Frames at `speed` for `ms` from `start`, the world advancing as fast as the speed asks. */
function run(
  history: ReturnType<typeof createSpeedHistory>,
  start: { ms: number; tick: number },
  ms: number,
  roomSpeed: number,
  ownSpeed = roomSpeed,
) {
  let samples = history.observe({ nowMs: start.ms, tick: start.tick, roomSpeed });
  for (let t = FRAME_MS; t <= ms; t += FRAME_MS) {
    samples = history.observe({
      nowMs: start.ms + t,
      tick: start.tick + (t / SECOND_MS) * TICKS_PER_SECOND * ownSpeed,
      roomSpeed,
    });
  }
  start.ms += ms;
  start.tick += (ms / SECOND_MS) * TICKS_PER_SECOND * ownSpeed;
  return samples;
}

describe('speed history', () => {
  it('takes one sample per wall second of the room speed and the world’s own pace', () => {
    const history = createSpeedHistory();
    const at = { ms: 0, tick: 0 };
    const samples = run(history, at, 3 * SECOND_MS + FRAME_MS, 3, 2);
    expect(samples).toHaveLength(3);
    for (const sample of samples) {
      expect(sample.roomSpeed).toBe(3);
      expect(sample.ownSpeed).toBeCloseTo(2, 1);
    }
  });

  it('keeps the same array between seconds', () => {
    const history = createSpeedHistory();
    history.observe({ nowMs: 0, tick: 0, roomSpeed: 1 });
    const first = history.observe({ nowMs: SECOND_MS, tick: TICKS_PER_SECOND, roomSpeed: 1 });
    expect(history.observe({ nowMs: SECOND_MS + FRAME_MS, tick: TICKS_PER_SECOND, roomSpeed: 1 })).toBe(
      first,
    );
  });

  it('fills a gap of several seconds with its average, and keeps only the newest two minutes', () => {
    const history = createSpeedHistory();
    history.observe({ nowMs: 0, tick: 0, roomSpeed: 1 });
    const gap = history.observe({ nowMs: 4 * SECOND_MS, tick: 4 * TICKS_PER_SECOND, roomSpeed: 0 });
    expect(gap).toEqual(Array.from({ length: 4 }, () => ({ roomSpeed: 0, ownSpeed: 1 })));
    const long = history.observe({ nowMs: (SPEED_HISTORY_SECONDS + 10) * SECOND_MS, tick: 0, roomSpeed: 2 });
    expect(long).toHaveLength(SPEED_HISTORY_SECONDS);
    expect(long.at(-1)).toEqual({ roomSpeed: 2, ownSpeed: 0 });
  });

  it('counts no pace while no world stands', () => {
    const history = createSpeedHistory();
    history.observe({ nowMs: 0, tick: null, roomSpeed: 1 });
    expect(history.observe({ nowMs: SECOND_MS, tick: 40, roomSpeed: 1 })).toEqual([
      { roomSpeed: 1, ownSpeed: 0 },
    ]);
  });
});
