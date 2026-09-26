import { describe, expect, it } from 'vitest';
import {
  assessTrust,
  type BenchReport,
  type BenchWindow,
  formatReport,
  percentile,
  summarize,
  summarizeSegment,
  systemGrowth,
} from '../bench/report/index.js';

/**
 * The benchmarks' pure reporting half (`bench/report/`). The benchmarks themselves are tools that only
 * run on demand (`npm run bench:sim`, `npm run bench:map`), but their statistics are ordinary code - so
 * the fold from raw samples to the reported numbers is pinned here, in the normal suite.
 */

const ENVIRONMENT = {
  node: 'v22.14.0',
  platform: 'darwin-arm64',
  cpuModel: 'Apple M3',
  cpuCount: 8,
  loadPerCpu: 0.3,
  totalMemMb: 16384,
  peakRssMb: 342,
  startedAt: '2026-07-27T09:11:00.000Z',
  wallSeconds: 42,
  rev: '9ab7c02',
  dirty: false,
  knobs: { ON_BENCH_TICKS: '4' },
  calibrationMs: { beforeMs: 0.84, afterMs: 0.86 },
};

const META: Parameters<typeof summarize>[2] = {
  world: {
    kind: 'synthetic',
    settlements: 2,
    fightersPerSide: 100,
    hunters: 0,
    mapCells: { width: 192, height: 140 },
    settlersAtStart: 340,
    settlersAtEnd: 340,
    buildings: 82,
  },
  ticks: { warmup: 10, measured: 4, windows: 1 },
  firstTick: 11,
  windows: [],
  environment: ENVIRONMENT,
  trust: { trustworthy: true, warnings: [] },
  stateHash: 'abc123',
};

function windowFixture(index: number, medianMs: number, overrides: Partial<BenchWindow> = {}): BenchWindow {
  return {
    index,
    fromTick: index * 100 + 1,
    toTick: index * 100 + 100,
    tickMs: { medianMs, p95Ms: medianMs * 2, p99Ms: medianMs * 3, maxMs: medianMs * 4 },
    systems: [{ name: 'ai', medianMs, p95Ms: medianMs * 2, maxMs: medianMs * 4, sharePct: 100 }],
    population: { settlers: 100 + index, fighters: 20 + index, buildings: 10 + index, resourceNodes: 500 },
    rssMb: 200 + index,
    heapUsedMb: 120 + index,
    gc: { count: 3, ms: 2.5, maxMs: 1.25 },
    ...overrides,
  };
}

describe('percentile', () => {
  it('is nearest-rank: every reported number is an observed sample', () => {
    const samples = [10, 1, 5, 3];
    expect(percentile(samples, 50)).toBe(3);
    expect(percentile(samples, 95)).toBe(10);
    expect(percentile(samples, 100)).toBe(10);
  });

  it('does not mutate its input', () => {
    const samples = [3, 1, 2];
    percentile(samples, 50);
    expect(samples).toEqual([3, 1, 2]);
  });

  it('reports 0 for an empty sample rather than NaN', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('handles a single sample at every percentile', () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe('summarize', () => {
  const perSystem = new Map<string, readonly number[]>([
    ['ai', [1, 1, 1, 9]],
    ['movement', [3, 3, 3, 3]],
    ['combat', [1, 1, 1, 1]],
  ]);
  const report = summarize(perSystem, [6, 6, 6, 20], META);

  it('orders rows by median cost, heaviest first', () => {
    expect(report.systems.map((s) => s.name)).toEqual(['movement', 'ai', 'combat']);
  });

  it('reports each system median, p95 and max (the tail exposes a spiking system its median hides)', () => {
    const ai = report.systems.find((s) => s.name === 'ai') as BenchReport['systems'][number];
    expect(ai.medianMs).toBe(1);
    expect(ai.p95Ms).toBe(9);
    expect(ai.maxMs).toBe(9);
  });

  it('reports shares of the summed per-system medians', () => {
    // medians: movement 3, ai 1, combat 1 -> total 5
    expect(report.systems.map((s) => s.sharePct)).toEqual([60, 20, 20]);
  });

  it('reports whole-tick cost separately from the per-system rows', () => {
    expect(report.tickMs).toEqual({ medianMs: 6, p95Ms: 20, p99Ms: 20, maxMs: 20 });
  });

  it('breaks median ties by name, so a report is stable across runs', () => {
    const tied = summarize(
      new Map([
        ['zebra', [1]],
        ['alpha', [1]],
      ]),
      [2],
      META,
    );
    expect(tied.systems.map((s) => s.name)).toEqual(['alpha', 'zebra']);
  });

  it('reports zero shares instead of NaN when nothing was measured', () => {
    const empty = summarize(new Map([['ai', []]]), [], META);
    expect(empty.systems[0]?.sharePct).toBe(0);
    expect(empty.tickMs).toEqual({ medianMs: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 });
  });

  it('carries the world/tick metadata and state hash through to the machine-readable report', () => {
    expect(report.world).toEqual(META.world);
    expect(report.ticks).toEqual(META.ticks);
    expect(report.stateHash).toBe('abc123');
  });
});

describe('tick spread', () => {
  it('shows the tail the p95 hides and the single stall the p99 hides', () => {
    // 1000 ticks: 985 at 1 ms, 14 at 5 ms and one 40 ms stall. Nearest-rank p95 is the 950th sample,
    // p99 the 990th.
    const samples = [...Array(985).fill(1), ...Array(14).fill(5), 40];
    const { tickMs } = summarizeSegment(new Map(), samples);
    expect(tickMs).toEqual({ medianMs: 1, p95Ms: 1, p99Ms: 5, maxMs: 40 });
  });
});

describe('summarizeSegment', () => {
  it('reports shares within the segment, so one window cannot be read against another', () => {
    const segment = summarizeSegment(
      new Map([
        ['ai', [3]],
        ['movement', [1]],
      ]),
      [5],
    );
    expect(segment.systems.map((s) => s.sharePct)).toEqual([75, 25]);
  });
});

describe('systemGrowth', () => {
  it('reports each system first window against last, heaviest last window first', () => {
    const growth = systemGrowth([windowFixture(0, 1), windowFixture(1, 4)]);
    expect(growth).toEqual([{ name: 'ai', firstMs: 1, lastMs: 4, factor: 4, lastSharePct: 100 }]);
  });

  it('reports no factor when the first window measured zero, rather than an infinite one', () => {
    const growth = systemGrowth([windowFixture(0, 0), windowFixture(1, 4)]);
    expect(growth[0]?.factor).toBeNull();
  });

  it('is empty for a single-window run, where growth has no meaning', () => {
    expect(systemGrowth([windowFixture(0, 1)])).toEqual([]);
  });
});

describe('assessTrust', () => {
  const clean = {
    loadPerCpu: 0.3,
    calibration: { beforeMs: 1, afterMs: 1.05 },
    windows: [windowFixture(0, 1)],
  };

  it('trusts a quiet box whose speed held across the run', () => {
    expect(assessTrust(clean)).toEqual({ trustworthy: true, warnings: [] });
  });

  it('rejects a contended box', () => {
    const verdict = assessTrust({ ...clean, loadPerCpu: 4 });
    expect(verdict.trustworthy).toBe(false);
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toContain('busy');
  });

  it('rejects a run whose own calibration drifted, since its windows are then incomparable', () => {
    const verdict = assessTrust({ ...clean, calibration: { beforeMs: 1, afterMs: 2 } });
    expect(verdict.trustworthy).toBe(false);
    expect(verdict.warnings[0]).toContain('drifted');
  });

  it('rejects a window spiking far above its own median', () => {
    const spiking = windowFixture(0, 1, { tickMs: { medianMs: 1, p95Ms: 9, p99Ms: 9, maxMs: 9 } });
    const verdict = assessTrust({ ...clean, windows: [spiking] });
    expect(verdict.trustworthy).toBe(false);
    expect(verdict.warnings[0]).toContain('window 1');
  });

  it('skips the load check where the OS reports no load average, rather than failing it', () => {
    expect(assessTrust({ ...clean, loadPerCpu: null }).trustworthy).toBe(true);
  });

  it('reports every failed check, not just the first', () => {
    const verdict = assessTrust({ ...clean, loadPerCpu: 4, calibration: { beforeMs: 1, afterMs: 2 } });
    expect(verdict.warnings).toHaveLength(2);
  });
});

describe('formatReport', () => {
  it('renders one row per system plus the world/tick header', () => {
    const text = formatReport(summarize(new Map([['ai', [1.5]]]), [2.25], META));
    expect(text).toContain('192x140 cells, 340 settlers, 82 buildings');
    expect(text).toContain('10 warmup + 4 measured');
    expect(text).toContain('abc123');
    expect(text).toContain('tick total: median 2.250 ms');
    expect(text).toMatch(/ai\s+1\.500\s+1\.500\s+1\.500\s+100\.0%/);
  });

  it('reports a population that moved across the window as a range, not a single number', () => {
    // A fighter run thins out as the battle resolves; the reader must see that the medians span two
    // populations rather than trust a single headline count.
    const drifted = { ...META, world: { ...META.world, settlersAtEnd: 210 } };
    const text = formatReport(summarize(new Map([['ai', [1]]]), [1], drifted));
    expect(text).toContain('340→210 settlers');
  });

  it('names the world each benchmark measured', () => {
    expect(formatReport(summarize(new Map(), [], META))).toContain('sim benchmark - 2 settlement(s)');
    const realMap = {
      ...META,
      world: {
        ...META.world,
        kind: 'realMap',
        mapId: 'magiczny_las_12_players',
        aiSeats: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        progression: true,
        needs: null,
      },
    } as Parameters<typeof summarize>[2];
    expect(formatReport(summarize(new Map(), [], realMap))).toContain(
      'map benchmark - magiczny_las_12_players, AI seats 0-12, progression on',
    );
  });

  it('omits the window and growth tables for a single-window run', () => {
    const text = formatReport(summarize(new Map([['ai', [1]]]), [1], META));
    expect(text).not.toContain('growth (window');
    expect(text).not.toContain('rss MB');
  });

  it('prints the window and growth tables once there is a curve to show', () => {
    const windowed = { ...META, windows: [windowFixture(0, 1), windowFixture(1, 4)] };
    const text = formatReport(summarize(new Map([['ai', [1]]]), [1], windowed));
    expect(text).toContain('growth (window 1 -> 2)');
    expect(text).toMatch(/ai\s+1\.000\s+4\.000\s+4\.0x/);
    // Window 2: median 4, p95 8, p99 12, max 16, 101 settlers, 21 fighters, 11 buildings, then GC 2.5 ms
    // over 3 collections, longest 1.3, heap 121.
    expect(text).toMatch(
      /2\/2\s+101\.\.200\s+4\.000\s+8\.000\s+12\.000\s+16\.000\s+101\s+21\s+11\s+2\.5\s+3\s+1\.3\s+121/,
    );
    expect(text).toContain('gc: 6 collection(s), 5.0 ms paused, longest 1.3 ms   heap at end 121 MB');
  });

  it('leads with a banner when the measurement cannot be trusted', () => {
    const suspect = {
      ...META,
      trust: { trustworthy: false, warnings: ['load average was 4.00 per cpu - this box was busy'] },
    };
    const text = formatReport(summarize(new Map([['ai', [1]]]), [1], suspect));
    expect(text.startsWith('!!! UNTRUSTWORTHY MEASUREMENT !!!')).toBe(true);
    expect(text).toContain('this box was busy');
    expect(text).toContain('trust: SUSPECT');
  });

  it('records the machine the numbers came from', () => {
    const text = formatReport(summarize(new Map([['ai', [1]]]), [1], META));
    expect(text).toContain('environment: node v22.14.0  darwin-arm64  8 cpu  load/cpu 0.30');
    expect(text).toContain('rev 9ab7c02 (clean)');
  });
});

describe('slowest ticks', () => {
  it('names the slowest measured ticks with the systems that filled them, slowest first', () => {
    const perSystem = new Map<string, readonly number[]>([
      ['ai', [1, 1, 9, 1]],
      ['combat', [2, 2, 2, 12]],
      ['planner', [3, 3, 3, 3]],
    ]);
    const report = summarize(perSystem, [6, 6, 14, 16], META);
    // META's first measured tick is 11, so sample 3 is tick 14.
    expect(report.slowestTicks.map((t) => [t.tick, t.totalMs])).toEqual([
      [14, 16],
      [13, 14],
      [11, 6],
      [12, 6],
    ]);
    expect(report.slowestTicks[0]?.systems).toEqual([
      { name: 'combat', ms: 12 },
      { name: 'planner', ms: 3 },
      { name: 'ai', ms: 1 },
    ]);
    // The nearest-rank median is 6, so ticks 2 (14 ms) and 3 (16 ms) are stutters, topped by ai and combat.
    expect(report.stutterSources).toEqual([
      { name: 'ai', slowTicks: 1 },
      { name: 'combat', slowTicks: 1 },
    ]);
    expect(summarize(perSystem, [6, 6, 7, 8], META).stutterSources).toEqual([]);
    expect(formatReport(report)).toContain('tick 14  16.000 ms  (combat 12.000, planner 3.000, ai 1.000)');
  });
});
