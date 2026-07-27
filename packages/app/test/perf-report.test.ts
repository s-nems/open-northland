import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { FrameStatsReport } from '../src/diag/frame-stats.js';
import { buildPerfReport, type PerfReportInputs } from '../src/view/runtime/debug-handle.js';

/**
 * The object an automated probe reads out of `window.__opennorthland.perf()`. Its load-bearing
 * property is that it survives `page.evaluate`, which throws on anything not structured-cloneable.
 */

function frameReport(overrides: Partial<FrameStatsReport['window']> = {}): FrameStatsReport {
  return {
    last: {
      elapsedMs: 100,
      tick: 4321,
      steps: 5,
      droppedTicks: 812,
      speed: 10,
      paused: false,
      entities: 4102,
      drawn: 380,
      pooled: 402,
      cpuMs: 82,
      simMs: 71,
      snapMs: 3,
      drawMs: 8,
    },
    ema: { frameMs: 100, cpuMs: 82, simMs: 71, snapMs: 3, drawMs: 8 },
    recent: { worstMs: 210, droppedTicks: 96, deliveredSpeed: 4.2, sustainedShortfall: true },
    window: {
      frames: 100,
      ms: 10_000,
      steps: 500,
      droppedTicks: 812,
      deliveredSpeed: 4.16,
      frameMs: { p50Ms: 96, p95Ms: 180, p99Ms: 210, maxMs: 240 },
      ...overrides,
    },
  };
}

function inputs(overrides: Partial<PerfReportInputs> = {}): PerfReportInputs {
  return {
    frame: frameReport(),
    requestedSpeed: 10,
    paused: false,
    maxStepsPerFrame: 5,
    droppedTicksTotal: 812,
    profiling: true,
    systems: [{ name: 'ai', calls: 500, totalMs: 35_500, meanMs: 71, maxMs: 190, sharePct: 86.5 }],
    sampling: {
      hidden: false,
      hardwareConcurrency: 10,
      devicePixelRatio: 2,
      canvas: { width: 1920, height: 1080 },
      heapMb: 512,
    },
    ...overrides,
  };
}

describe('buildPerfReport', () => {
  it('survives structured cloning, which is what page.evaluate requires', () => {
    const report = buildPerfReport(inputs());
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('reports the requested speed alongside the one actually delivered', () => {
    const { throughput } = buildPerfReport(inputs());
    expect(throughput.requestedSpeed).toBe(10);
    expect(throughput.deliveredSpeed).toBeLessThan(throughput.requestedSpeed);
    expect(throughput.droppedTicksTotal).toBeGreaterThan(0);
    expect(throughput.ticksPerSecond).toBeCloseTo(4.16 * TICKS_PER_SECOND, 5);
  });

  it('names the cap that produced the shortfall, so the number is explainable', () => {
    expect(buildPerfReport(inputs()).throughput.maxStepsPerFrame).toBe(5);
  });

  it('splits the frame into what the loop timed and the GPU remainder', () => {
    const { frame } = buildPerfReport(inputs());
    expect(frame.fps).toBe(10);
    expect(frame.gpuMs).toBeCloseTo(18, 5);
  });

  it('never reports a negative GPU remainder when the CPU timing overshoots the frame', () => {
    const overshooting = frameReport();
    const report = buildPerfReport(
      inputs({ frame: { ...overshooting, ema: { ...overshooting.ema, cpuMs: 200 } } }),
    );
    expect(report.frame.gpuMs).toBe(0);
  });

  it('flags that profiling inflates the sim milliseconds it just reported', () => {
    expect(buildPerfReport(inputs()).profiling).toBe(true);
    expect(buildPerfReport(inputs({ profiling: false, systems: [] })).systems).toEqual([]);
  });

  it('carries the sampling conditions, without which no timing above can be trusted', () => {
    const hidden = buildPerfReport(inputs({ sampling: { ...inputs().sampling, hidden: true } }));
    expect(hidden.sampling.hidden).toBe(true);
    expect(hidden.sampling.hardwareConcurrency).toBe(10);
  });

  it('reports zeros rather than throwing before the first frame', () => {
    const empty = frameReport();
    const report = buildPerfReport(inputs({ frame: { ...empty, last: null } }));
    expect(report.tick).toBe(0);
    expect(report.entities).toBe(0);
  });
});
