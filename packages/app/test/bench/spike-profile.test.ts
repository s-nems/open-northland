import type { Profiler } from 'node:inspector';
import { describe, expect, it } from 'vitest';
import { busiestTickSpans, tickSpikes } from '../../bench/spike-profile.js';

/** A native frame: no url, so the location resolves without a source map on disk. */
function node(id: number, functionName: string, children: number[] = []): Profiler.ProfileNode {
  return {
    id,
    callFrame: { functionName, scriptId: '0', url: '', lineNumber: 0, columnNumber: 0 },
    children,
  };
}

const ROOT = 1;
const STEP = 2;
const PLAN = 3;
const ROUTE = 4;
const FIGHT = 5;
const US_PER_MS = 1000;
/** The profile clock starts here; the performance clock reads zero at the same moment. */
const PROFILE_START_US = 5_000_000;

/** One sample per millisecond: tick A spends 1 ms in plan and 2 ms in route, tick B 1 ms in fight. */
const PROFILE: Profiler.Profile = {
  nodes: [
    node(ROOT, '(root)', [STEP]),
    node(STEP, 'step', [PLAN, FIGHT]),
    node(PLAN, 'plan', [ROUTE]),
    node(ROUTE, 'route'),
    node(FIGHT, 'fight'),
  ],
  startTime: PROFILE_START_US,
  endTime: PROFILE_START_US + 6 * US_PER_MS,
  samples: [STEP, PLAN, ROUTE, ROUTE, STEP, FIGHT],
  timeDeltas: [1, 1, 1, 1, 1, 1].map((ms) => ms * US_PER_MS),
};
const CAPTURE = { profile: PROFILE, stoppedAtMs: 6 };

describe('tickSpikes', () => {
  it('counts only the samples stamped inside each tick', () => {
    const [a, b] = tickSpikes(CAPTURE, [
      { tick: 10, startMs: 1.5, durationMs: 3 },
      { tick: 11, startMs: 5.5, durationMs: 1 },
    ]);

    expect(a?.summary.sampled).toBe(3);
    expect(a?.samples).toBe(3);
    expect(a?.summary.functions.filter((f) => f.self > 0).map((f) => [f.name, f.self])).toEqual([
      ['route', 2],
      ['plan', 1],
    ]);
    expect(a?.summary.functionsByTotal.find((f) => f.name === 'plan')?.total).toBe(3);
    expect(b?.summary.functions.filter((f) => f.self > 0).map((f) => f.name)).toEqual(['fight']);
  });

  it('walks the heaviest callee at each level below the root', () => {
    const [spike] = tickSpikes(CAPTURE, [{ tick: 10, startMs: 0, durationMs: 6.5 }]);

    expect(spike?.path.map((f) => [f.name, f.totalMs])).toEqual([
      ['step', 6],
      ['plan', 3],
      ['route', 2],
    ]);
  });

  it('reports the longest time between two samples in the tick', () => {
    const preempted = {
      ...CAPTURE,
      profile: {
        ...PROFILE,
        endTime: PROFILE_START_US + 45 * US_PER_MS,
        timeDeltas: [1, 1, 40, 1, 1, 1].map((ms) => ms * US_PER_MS),
      },
      stoppedAtMs: 45,
    };

    const [spike] = tickSpikes(preempted, [{ tick: 10, startMs: 1.5, durationMs: 42 }]);

    expect(spike?.longestGapMs).toBe(40);
    expect(spike?.runningMs).toBe(3);
    expect(spike?.samples).toBe(3);
  });
});

describe('busiestTickSpans', () => {
  it('ranks ticks by the time the thread ran, so a stalled tick does not lead', () => {
    const stalled = {
      profile: {
        ...PROFILE,
        endTime: PROFILE_START_US + 45 * US_PER_MS,
        timeDeltas: [1, 1, 40, 1, 1, 1].map((ms) => ms * US_PER_MS),
      },
      stoppedAtMs: 45,
    };
    const timings = {
      firstTick: 100,
      tickSamples: Float64Array.of(41, 3),
      tickStartsMs: Float64Array.of(1.5, 42.5),
    };

    expect(busiestTickSpans(stalled, timings, 2)).toEqual([
      { tick: 101, startMs: 42.5, durationMs: 3 },
      { tick: 100, startMs: 1.5, durationMs: 41 },
    ]);
  });
});
