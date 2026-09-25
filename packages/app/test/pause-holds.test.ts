import { describe, expect, it } from 'vitest';
import { createPauseHolds } from '../src/view/runtime/pause-holds.js';

describe('createPauseHolds', () => {
  it('forces the seam on the first hold and releases it on the last, whichever owner leaves', () => {
    const calls: string[] = [];
    const holds = createPauseHolds(
      {
        forcePause: () => calls.push('force'),
        releaseForcedPause: () => calls.push('release'),
      },
      true,
    );
    holds.hold('mission');
    holds.hold('menu');
    holds.release('menu');
    expect(calls).toEqual(['force']);
    holds.release('mission');
    expect(calls).toEqual(['force', 'release']);
  });

  it('ignores a release without a hold and a repeated hold by the same owner', () => {
    const calls: string[] = [];
    const holds = createPauseHolds(
      {
        forcePause: () => calls.push('force'),
        releaseForcedPause: () => calls.push('release'),
      },
      true,
    );
    holds.release('ghost');
    holds.hold('menu');
    holds.hold('menu');
    holds.release('menu');
    expect(calls).toEqual(['force', 'release']);
  });

  it('reports a hold while any owner keeps one', () => {
    const holds = createPauseHolds(
      { forcePause: () => undefined, releaseForcedPause: () => undefined },
      true,
    );
    expect(holds.isHeld()).toBe(false);
    holds.hold('verdict');
    holds.hold('menu');
    holds.release('verdict');
    expect(holds.isHeld()).toBe(true);
    holds.release('menu');
    expect(holds.isHeld()).toBe(false);
  });

  it('never refuses a press over a shared clock, which its holds do not stop', () => {
    const holds = createPauseHolds(
      { forcePause: () => undefined, releaseForcedPause: () => undefined },
      false,
    );
    holds.hold('menu');
    expect(holds.isHeld()).toBe(false);
  });
});
