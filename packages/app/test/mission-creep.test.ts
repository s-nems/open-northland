import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_SCROLL_DELAY_MS,
  AUTO_SCROLL_PX_PER_S,
  MAX_CREEP_STEP_MS,
  startCreep,
} from '../src/hud/tool-panel/mission/creep.js';

/** The mission sheet's own descent: a pause, then a fixed rate per second of watched time, and no
 *  creep at all for a viewer who asked for reduced motion. */

type MediaStub = { matchMedia?: unknown };
const media = globalThis as MediaStub;

afterEach(() => {
  media.matchMedia = undefined;
});

/** Walks the creep forward `ms` in frame-sized steps from `at`, answering the last offset. */
function run(creep: { advance(now: number, scale: number): number }, from: number, ms: number, scale = 1) {
  let at = from;
  let offset = 0;
  for (let done = 0; done < ms; done += MAX_CREEP_STEP_MS) {
    at += MAX_CREEP_STEP_MS;
    offset = creep.advance(at, scale);
  }
  return { at, offset };
}

describe('startCreep', () => {
  it('holds the page through the pause, then walks it down at the rate', () => {
    const creep = startCreep(0);
    expect(creep).not.toBeNull();
    if (creep === null) return;
    const paused = run(creep, 0, AUTO_SCROLL_DELAY_MS);
    expect(paused.offset).toBe(0);
    const walked = run(creep, paused.at, 2000);
    expect(walked.offset).toBeCloseTo(2 * AUTO_SCROLL_PX_PER_S, 5);
    expect(run(creep, walked.at, 2000, 2).offset).toBeCloseTo(2 * 4 * AUTO_SCROLL_PX_PER_S, 5);
  });

  it('counts a frame gap as one step, so a hidden tab does not come back at the bottom', () => {
    const creep = startCreep(0);
    if (creep === null) throw new Error('creep expected');
    expect(creep.advance(60_000, 1)).toBe(0);
    expect(creep.advance(60_000 + MAX_CREEP_STEP_MS, 1)).toBe(0);
  });

  it('does not start for a viewer who asked for reduced motion', () => {
    media.matchMedia = (query: string) => ({ matches: query.includes('reduced-motion') });
    expect(startCreep(0)).toBeNull();
  });
});
