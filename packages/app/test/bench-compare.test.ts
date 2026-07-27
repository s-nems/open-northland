import { describe, expect, it } from 'vitest';
import { compareReports, formatComparison, readReport } from '../bench/report/compare.js';
import type { BenchReport, BenchWindow } from '../bench/report/index.js';

/**
 * The A/B comparison (`npm run bench:compare`). Its job is to turn two reports into a verdict, so the
 * cases that matter are the ones where it must REFUSE: different worlds, different run lengths, or
 * numbers too small for a percentage to mean anything.
 */

function window(index: number, medianMs: number): BenchWindow {
  return {
    index,
    fromTick: index * 100 + 1,
    toTick: index * 100 + 100,
    tickMs: { medianMs, p95Ms: medianMs * 2 },
    systems: [{ name: 'ai', medianMs, p95Ms: medianMs * 2, sharePct: 100 }],
    population: { settlers: 100, buildings: 10, resourceNodes: 500 },
    rssMb: 200,
  };
}

function report(overrides: Partial<BenchReport> = {}): BenchReport {
  return {
    world: {
      kind: 'realMap',
      mapId: 'magiczny_las',
      aiSeats: 6,
      mapCells: { width: 240, height: 190 },
      settlersAtStart: 628,
      settlersAtEnd: 628,
      buildings: 21,
    },
    ticks: { warmup: 60, measured: 600, windows: 2 },
    tickMs: { medianMs: 6, p95Ms: 12 },
    systems: [
      { name: 'ai', medianMs: 4, p95Ms: 8, sharePct: 80 },
      { name: 'movement', medianMs: 1, p95Ms: 2, sharePct: 20 },
    ],
    windows: [window(0, 5), window(1, 7)],
    environment: {
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
      knobs: {},
      calibrationMs: { beforeMs: 1, afterMs: 1 },
    },
    trust: { trustworthy: true, warnings: [] },
    stateHash: 'abc123',
    ...overrides,
  };
}

function systemsOf(medians: Readonly<Record<string, number>>): BenchReport['systems'] {
  return Object.entries(medians).map(([name, medianMs]) => ({
    name,
    medianMs,
    p95Ms: medianMs * 2,
    sharePct: 0,
  }));
}

describe('compareReports refuses', () => {
  it('a synthetic run against a real-map run', () => {
    const synthetic = report({
      world: {
        kind: 'synthetic',
        settlements: 4,
        fightersPerSide: 0,
        mapCells: { width: 240, height: 190 },
        settlersAtStart: 628,
        settlersAtEnd: 628,
        buildings: 21,
      },
    });
    expect(() => compareReports(synthetic, report())).toThrow(/cannot compare a synthetic run/);
  });

  it('two different real maps', () => {
    const other = report({ world: { ...report().world, mapId: 'blekiny_nurt' } as BenchReport['world'] });
    expect(() => compareReports(report(), other)).toThrow(/different worlds/);
  });

  it('two different run lengths', () => {
    const longer = report({ ticks: { warmup: 60, measured: 1200, windows: 2 } });
    expect(() => compareReports(report(), longer)).toThrow(/different run lengths/);
  });
});

describe('compareReports', () => {
  it('reports a per-system delta with a verdict', () => {
    const after = report({ systems: systemsOf({ ai: 5.52, movement: 1 }) });
    const ai = compareReports(report(), after).rows.find((r) => r.name === 'ai');
    expect(ai?.verdict).toBe('slower');
    expect(ai?.deltaPct).toBeCloseTo(38, 0);
  });

  it('calls a change inside the noise band no change at all', () => {
    const after = report({ systems: systemsOf({ ai: 4.2, movement: 1 }) });
    expect(compareReports(report(), after).rows.find((r) => r.name === 'ai')?.verdict).toBe('within-noise');
  });

  it('refuses to put a percentage on systems too cheap to measure', () => {
    const before = report({ systems: systemsOf({ atomic: 0.004 }) });
    const after = report({ systems: systemsOf({ atomic: 0.009 }) });
    const row = compareReports(before, after).rows.find((r) => r.name === 'atomic');
    expect(row?.verdict).toBe('below-floor');
    expect(row?.deltaPct).toBeNull();
  });

  it('names a system that only one side measured instead of comparing it', () => {
    const after = report({ systems: systemsOf({ ai: 4, movement: 1, herding: 2 }) });
    const rows = compareReports(report(), after).rows;
    expect(rows.find((r) => r.name === 'herding')?.verdict).toBe('added');
    expect(rows.find((r) => r.name === 'herding')?.deltaPct).toBeNull();
  });

  it('always appends the whole-tick row, which the per-system rows do not sum to', () => {
    expect(compareReports(report(), report()).rows.at(-1)?.name).toBe('tick total');
  });

  it('reports a changed state hash rather than raising: the runs measured different behaviour', () => {
    const comparison = compareReports(report(), report({ stateHash: 'def456' }));
    expect(comparison.stateHashIdentical).toBe(false);
    expect(formatComparison(comparison)).toContain('did not measure the same behaviour');
  });

  it('widens the band and leads with a banner when either side was untrustworthy', () => {
    const busy = report({ trust: { trustworthy: false, warnings: ['load average was 4.95 per cpu'] } });
    const comparison = compareReports(report(), busy);
    expect(comparison.noiseBandPct).toBe(20);
    expect(formatComparison(comparison).startsWith('!!! UNTRUSTWORTHY COMPARISON !!!')).toBe(true);
  });

  it('compares whole-run rows only when the two runs were cut differently', () => {
    const coarse = report({ windows: [window(0, 6)] });
    const comparison = compareReports(report(), coarse);
    expect(comparison.windowRows).toEqual([]);
    expect(comparison.notes.join(' ')).toContain('different window counts');
  });

  it('reports growth either side, which separates a lower intercept from a flatter curve', () => {
    const flatter = report({ windows: [window(0, 5), window(1, 5)] });
    const comparison = compareReports(report(), flatter);
    expect(comparison.growth?.beforeFactor).toBeCloseTo(1.4, 5);
    expect(comparison.growth?.afterFactor).toBe(1);
  });
});

describe('readReport', () => {
  it('accepts a report this tool wrote', () => {
    expect(readReport(JSON.parse(JSON.stringify(report())), 'a.json').stateHash).toBe('abc123');
  });

  it('names the file and the missing field rather than failing later on undefined', () => {
    expect(() => readReport({ world: { kind: 'realMap' } }, 'stale.json')).toThrow(
      /stale\.json is not a benchmark report: missing ticks\.measured/,
    );
    expect(() => readReport('not json', 'x.json')).toThrow(/x\.json is not a benchmark report/);
  });
});
