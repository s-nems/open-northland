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
    mapCells: { width: 192, height: 140 },
    settlersAtStart: 340,
    settlersAtEnd: 340,
    buildings: 82,
  },
  ticks: { warmup: 10, measured: 4, windows: 1 },
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
    tickMs: { medianMs, p95Ms: medianMs * 2 },
    systems: [{ name: 'ai', medianMs, p95Ms: medianMs * 2, sharePct: 100 }],
    population: { settlers: 100 + index, buildings: 10 + index, resourceNodes: 500 },
    rssMb: 200 + index,
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

  it('reports each system median and p95 (the p95 exposes a spiking system its median hides)', () => {
    const ai = report.systems.find((s) => s.name === 'ai') as BenchReport['systems'][number];
    expect(ai.medianMs).toBe(1);
    expect(ai.p95Ms).toBe(9);
  });

  it('reports shares of the summed per-system medians', () => {
    // medians: movement 3, ai 1, combat 1 -> total 5
    expect(report.systems.map((s) => s.sharePct)).toEqual([60, 20, 20]);
  });

  it('reports whole-tick cost separately from the per-system rows', () => {
    expect(report.tickMs).toEqual({ medianMs: 6, p95Ms: 20 });
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
    expect(empty.tickMs).toEqual({ medianMs: 0, p95Ms: 0 });
  });

  it('carries the world/tick metadata and state hash through to the machine-readable report', () => {
    expect(report.world).toEqual(META.world);
    expect(report.ticks).toEqual(META.ticks);
    expect(report.stateHash).toBe('abc123');
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
    const spiking = windowFixture(0, 1, { tickMs: { medianMs: 1, p95Ms: 9 } });
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
    expect(text).toMatch(/ai\s+1\.500\s+1\.500\s+100\.0%/);
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
      world: { ...META.world, kind: 'realMap', mapId: 'magiczny_las', aiSeats: 6 },
    } as Parameters<typeof summarize>[2];
    expect(formatReport(summarize(new Map(), [], realMap))).toContain(
      'map benchmark - magiczny_las, 6 AI seat(s)',
    );
  });

  it('omits the window and growth tables for a single-window run', () => {
    const text = formatReport(summarize(new Map([['ai', [1]]]), [1], META));
    expect(text).not.toContain('growth (window');
    expect(text).not.toContain('buildings   rss MB');
  });

  it('prints the window and growth tables once there is a curve to show', () => {
    const windowed = { ...META, windows: [windowFixture(0, 1), windowFixture(1, 4)] };
    const text = formatReport(summarize(new Map([['ai', [1]]]), [1], windowed));
    expect(text).toContain('growth (window 1 -> 2)');
    expect(text).toMatch(/ai\s+1\.000\s+4\.000\s+4\.0x/);
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
