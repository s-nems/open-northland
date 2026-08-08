import { describe, expect, it } from 'vitest';
import { createDotReplotGate, REPLOT_MIN_MS } from '../src/hud/minimap/replot-gate.js';
import { snapshotOf } from './support/snapshot.js';

/** The sim's base clock; at speed 3 the frame loop steps roughly this many ticks per second times three. */
const TICKS_PER_SECOND = 12;

/**
 * A gate over a hand-cranked clock, driven the way the minimap drives it: one call per rendered frame,
 * against whatever snapshot the sim handed out that frame.
 */
function gateOver() {
  let clock = 1000;
  const claim = createDotReplotGate(() => clock);
  return {
    frame: (snapshot: ReturnType<typeof snapshotOf>, advanceMs = 0): boolean => {
      clock += advanceMs;
      return claim(snapshot);
    },
  };
}

describe('createDotReplotGate', () => {
  it('plots the first frame it sees', () => {
    expect(gateOver().frame(snapshotOf([]))).toBe(true);
  });

  it('refuses the rest of the window even though every frame brings a new snapshot', () => {
    const g = gateOver();
    g.frame(snapshotOf([]));
    const refused = [30, 30, 30].map((ms) => g.frame(snapshotOf([]), ms));
    expect(refused).toEqual([false, false, false]);
    expect(g.frame(snapshotOf([]), REPLOT_MIN_MS)).toBe(true);
  });

  it('holds the plot rate at the window however fast frames arrive', () => {
    const g = gateOver();
    const frameMs = 8; // 125 fps, far above any tick rate
    const seconds = 4;
    let plots = 0;
    for (let i = 0; i < (seconds * 1000) / frameMs; i++) if (g.frame(snapshotOf([]), frameMs)) plots++;
    expect(plots).toBe((seconds * 1000) / REPLOT_MIN_MS);
  });

  it('cuts the plot rate below the tick rate the old tick guard allowed', () => {
    const g = gateOver();
    const frameMs = 1000 / TICKS_PER_SECOND; // one frame per tick, the speed-1 worst case
    let plots = 0;
    for (let i = 0; i < TICKS_PER_SECOND; i++) if (g.frame(snapshotOf([]), frameMs)) plots++;
    expect(plots).toBeLessThan(TICKS_PER_SECOND);
  });

  it('costs nothing while the sim holds one snapshot, however long it is held', () => {
    const g = gateOver();
    const held = snapshotOf([]);
    expect(g.frame(held)).toBe(true);
    expect(g.frame(held, REPLOT_MIN_MS * 10)).toBe(false);
    expect(g.frame(held, REPLOT_MIN_MS * 10)).toBe(false);
  });

  it('lands a refused plot once the window opens, without a further snapshot', () => {
    const g = gateOver();
    g.frame(snapshotOf([]));
    const refused = snapshotOf([]);
    expect(g.frame(refused, 10)).toBe(false); // too soon after the first plot
    expect(g.frame(refused, REPLOT_MIN_MS)).toBe(true); // the same snapshot still heals
  });

  it('re-plots a same-tick mutation, which a tick-keyed gate would miss', () => {
    const g = gateOver();
    g.frame(snapshotOf([]));
    const mutatedUnderSameTick = snapshotOf([]);
    expect(g.frame(mutatedUnderSameTick, REPLOT_MIN_MS)).toBe(true);
  });
});
