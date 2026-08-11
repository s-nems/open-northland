import { describe, expect, it } from 'vitest';
import type { TimedEvent } from '../src/stages/music/events.js';
import { repeatedLoopFrames, spliceSteadyLoop, withRepeatedLoop } from '../src/stages/music/loop.js';

/**
 * Publishing a segment so it loops on its own decay: the loop region is queued a second time and that
 * traversal replaces the first, which was standing under the intro's decay instead.
 */

/** `[1..n]` as a channel, so every spliced frame is identifiable by its value. */
const ramp = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => i + 1);

const on = (t: number, note: number): TimedEvent => ({ e: 'on', t, id: 1, note, vel: 100 });
const off = (t: number, note: number): TimedEvent => ({ e: 'off', t, id: 1, note });

describe('withRepeatedLoop', () => {
  it('queues the loop region again a region-length later, in frame order', () => {
    // Intro [0, 10), loop region [10, 40): the repeat lands 30 frames on.
    const events = [on(0, 60), on(10, 62), on(25, 64)];
    expect(withRepeatedLoop(events, 10, 40, 2)).toEqual([
      on(0, 60),
      on(10, 62),
      on(25, 64),
      on(40, 62),
      on(55, 64),
    ]);
  });

  it('drops what the next pass starts past the end, so only this one decays into the repeat', () => {
    const events = [on(10, 60), on(40, 62), { e: 'cc', t: 45, id: 1, cc: 7, val: 1 } as const];
    // Only the note inside the region survives, and its repeat lands where the dropped one stood.
    expect(withRepeatedLoop(events, 10, 40, 2)).toEqual([on(10, 60), on(40, 60)]);
  });

  it('keeps a note-off past the end and repeats it too, so neither pass hangs', () => {
    expect(withRepeatedLoop([on(20, 60), off(45, 60)], 10, 40, 2)).toEqual([
      on(20, 60),
      off(45, 60),
      on(50, 60),
      off(75, 60),
    ]);
  });

  it('queues every traversal the published one has to settle behind', () => {
    expect(withRepeatedLoop([on(0, 60), on(10, 62)], 10, 40, 3)).toEqual([
      on(0, 60),
      on(10, 62),
      on(40, 62),
      on(70, 62),
    ]);
  });

  it('leaves a segment that is all intro alone', () => {
    const events = [on(0, 60), on(5, 62)];
    expect(withRepeatedLoop(events, 10, 10, 2)).toEqual(events);
  });
});

describe('repeatedLoopFrames', () => {
  it('covers the pass, the repeated region, and the decay past it', () => {
    expect(repeatedLoopFrames(10, 40, 2, 5)).toBe(40 + 30 + 5);
    expect(repeatedLoopFrames(10, 40, 3, 5)).toBe(40 + 30 + 30 + 5);
  });
});

describe('spliceSteadyLoop', () => {
  it('keeps the intro and publishes the loop region from its second traversal', () => {
    const channel = ramp(80);
    const [out] = spliceSteadyLoop([channel], 3, 8, 2);
    // Intro [0, 3) as played, then frames [8, 13) - the repeat - in place of [3, 8).
    expect([...(out as Float32Array)]).toEqual([1, 2, 3, 9, 10, 11, 12, 13]);
  });

  it('splices each channel against its own repeat', () => {
    const left = ramp(20);
    const right = ramp(20).map((v) => -v);
    const [l, r] = spliceSteadyLoop([left, right], 2, 5, 2);
    expect([...(l as Float32Array)]).toEqual([1, 2, 6, 7, 8]);
    expect([...(r as Float32Array)]).toEqual([-1, -2, -6, -7, -8]);
  });

  it('reaches one region further in for each traversal past the second', () => {
    const channel = ramp(80);
    const [out] = spliceSteadyLoop([channel], 3, 8, 3);
    expect([...(out as Float32Array)]).toEqual([1, 2, 3, 14, 15, 16, 17, 18]);
  });

  it('publishes a segment that is all loop region entirely from the second traversal', () => {
    const channel = ramp(12);
    const [out] = spliceSteadyLoop([channel], 0, 4, 2);
    expect([...(out as Float32Array)]).toEqual([5, 6, 7, 8]);
  });
});
