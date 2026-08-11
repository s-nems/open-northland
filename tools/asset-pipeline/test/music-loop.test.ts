import { describe, expect, it } from 'vitest';
import { foldLoopTail } from '../src/stages/music/loop.js';

/**
 * The loop fold: what still rings past the segment's end has to land on the start of the loop region,
 * so a trimmed file repeats the way an uninterrupted sequencer would.
 */

/** `[0..n)` as a channel, so every folded sample is identifiable by its value. */
const ramp = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => i + 1);

describe('foldLoopTail', () => {
  it('adds the tail onto the loop region, leaving the intro untouched', () => {
    const channel = ramp(10);
    foldLoopTail([channel], 8, 3);
    // Intro [0, 3) is the one-shot the loop never returns to.
    expect([...channel.subarray(0, 3)]).toEqual([1, 2, 3]);
    // Loop region from 3 takes frames 8 and 9 onto 3 and 4.
    expect([...channel.subarray(3, 8)]).toEqual([4 + 9, 5 + 10, 6, 7, 8]);
  });

  it('folds each channel against its own tail', () => {
    const left = ramp(6);
    const right = ramp(6).map((v) => -v);
    foldLoopTail([left, right], 4, 0);
    expect([...left.subarray(0, 4)]).toEqual([1 + 5, 2 + 6, 3, 4]);
    expect([...right.subarray(0, 4)]).toEqual([-1 - 5, -2 - 6, -3, -4]);
  });

  it('folds only what the loop region can hold, never reaching past the trim point', () => {
    const channel = ramp(12);
    // Region [4, 6) is two frames; the six-frame tail cannot all land inside it.
    foldLoopTail([channel], 6, 4);
    expect([...channel.subarray(4, 6)]).toEqual([5 + 7, 6 + 8]);
    expect([...channel.subarray(6)]).toEqual([7, 8, 9, 10, 11, 12]); // past the trim, untouched
  });

  it('leaves a segment rendered no longer than its own end alone', () => {
    const channel = ramp(4);
    foldLoopTail([channel], 4, 1);
    expect([...channel]).toEqual([1, 2, 3, 4]);
  });

  it('does nothing when the loop region is empty', () => {
    const channel = ramp(4);
    foldLoopTail([channel], 2, 2);
    expect([...channel]).toEqual([1, 2, 3, 4]);
  });
});
