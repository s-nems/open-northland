import { MS_PER_TICK, TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type FrameSample, FrameStats } from '../src/diag/frame-stats.js';

/**
 * The frame-timing fold behind the on-canvas readout and the debug handle. It used to live in the
 * overlay's closure, where nothing but an eye could check it.
 */

function sample(overrides: Partial<FrameSample> = {}): FrameSample {
  return {
    elapsedMs: 16,
    tick: 100,
    steps: 1,
    droppedTicks: 0,
    speed: 1,
    paused: false,
    entities: 500,
    drawn: 120,
    pooled: 130,
    cpuMs: 10,
    simMs: 6,
    receiveMs: 0,
    snapMs: 1,
    drawMs: 3,
    ...overrides,
  };
}

describe('FrameStats', () => {
  it('reports nothing before the first frame rather than zeros that look like a stalled loop', () => {
    expect(new FrameStats().report().last).toBeNull();
  });

  it('seeds the moving averages on the first sample instead of easing up from zero', () => {
    const stats = new FrameStats();
    stats.record(sample({ cpuMs: 10 }));
    expect(stats.report().ema.cpuMs).toBe(10);
  });

  it('reports the delivered multiplier over the window, not the requested one', () => {
    const stats = new FrameStats();
    // One second of frames running two ticks each: 2x the base rate.
    for (let i = 0; i < 60; i++) stats.record(sample({ elapsedMs: 1000 / 60, steps: 2 }));
    expect(stats.report().window.deliveredSpeed).toBeCloseTo((60 * 2) / TICKS_PER_SECOND, 1);
  });

  it('ignores paused frames in the delivered rate, which would otherwise read as a stalled sim', () => {
    const stats = new FrameStats();
    stats.record(sample({ steps: 1, elapsedMs: MS_PER_TICK }));
    const running = stats.report().recent.deliveredSpeed;
    for (let i = 0; i < 20; i++) stats.record(sample({ paused: true, steps: 0 }));
    expect(stats.report().recent.deliveredSpeed).toBe(running);
  });

  it('reads a healthy x1 session as x1, though no single frame ever delivers it', () => {
    // 60 fps against a 12 Hz tick: the loop runs one tick every fifth frame, so a per-frame ratio reads
    // either 0 or 5 and never 1. Smoothing those samples instead of averaging over elapsed time reports
    // a shortfall the loop is not having, and the readout then claims a stall on an idle machine.
    const stats = new FrameStats();
    for (let i = 0; i < 300; i++) {
      stats.record(sample({ elapsedMs: 1000 / 60, steps: i % 5 === 0 ? 1 : 0 }));
    }
    // To the tenth the readout prints: where the window boundary falls between two ticks costs a
    // percent or so, which is far below the shortfall anything is allowed to report.
    expect(stats.report().recent.deliveredSpeed).toBeCloseTo(1, 1);
    expect(stats.report().recent.droppedTicks).toBe(0);
  });

  it('derives the window drop count from the monotonic session total', () => {
    const stats = new FrameStats();
    stats.record(sample({ droppedTicks: 40 }));
    stats.reset();
    stats.record(sample({ droppedTicks: 55 }));
    expect(stats.report().window.droppedTicks).toBe(15);
  });

  it('does not read a blocking load as the machine failing to keep up', () => {
    // The map decode blocks the frame loop and the timestep discards the wall-clock it missed. Calling
    // that a shortfall would tell every player their machine is struggling, at every session start.
    const stats = new FrameStats();
    stats.record(sample({ elapsedMs: 3_000, steps: 5, droppedTicks: 9 }));
    // Still the worst frame, which is a raw fact about frame time and reported as one.
    expect(stats.report().recent.worstMs).toBe(3_000);
    for (let i = 0; i < 30; i++) stats.record(sample({ elapsedMs: 1000 / 60, droppedTicks: 9 }));
    expect(stats.report().recent.droppedTicks).toBe(0);
    expect(stats.report().recent.sustainedShortfall).toBe(false);
  });

  describe('sustained shortfall', () => {
    /** Exact in binary, so the rolling windows close on whole seconds of {@link run} time. */
    const FRAME_MS = 1000 / 64;
    /** Frames of `elapsedMs` asking for `speed` and delivering `delivered` of it, as the fixed timestep
     *  would: whole steps, the fraction carried to the next frame. */
    function run(
      stats: FrameStats,
      ms: number,
      opts: { speed?: number; delivered?: number; elapsedMs?: number; dropPerFrame?: number } = {},
    ): void {
      const { speed = 1, delivered = speed, elapsedMs = FRAME_MS, dropPerFrame = 0 } = opts;
      for (let t = 0; t < ms; t += elapsedMs) {
        carry += (elapsedMs / 1000) * TICKS_PER_SECOND * delivered;
        const steps = Math.floor(carry);
        carry -= steps;
        dropped += dropPerFrame;
        stats.record(sample({ elapsedMs, speed, steps, droppedTicks: dropped }));
      }
    }
    let carry = 0;
    let dropped = 0;
    const fresh = (): FrameStats => {
      carry = 0;
      dropped = 0;
      return new FrameStats();
    };
    const shortfall = (stats: FrameStats): boolean => stats.report().recent.sustainedShortfall;

    it('holds when a worker delivers below the request without dropping a tick', () => {
      const stats = fresh();
      run(stats, 2_000, { speed: 5 });
      expect(shortfall(stats)).toBe(false);
      // The held worker clock: fewer ticks arrive, none is discarded.
      run(stats, 1_600, { speed: 5, delivered: 3 });
      expect(stats.report().recent.droppedTicks).toBe(0);
      expect(shortfall(stats)).toBe(true);
      expect(stats.sustainedShortfallSpeed()).toBeCloseTo(3, 0);
      expect(stats.report().recent.deliveredSpeed).toBeCloseTo(3, 0);
    });

    it('reads a healthy session as no shortfall at any requested speed', () => {
      for (const speed of [1, 2, 5]) {
        const stats = fresh();
        run(stats, 5_000, { speed });
        expect(shortfall(stats)).toBe(false);
        expect(stats.sustainedShortfallSpeed()).toBeNull();
      }
    });

    it('does not call one slow window a sustained shortfall', () => {
      const stats = fresh();
      run(stats, 2_000);
      run(stats, 1_000, { delivered: 0.4 });
      run(stats, 3_000);
      expect(shortfall(stats)).toBe(false);
    });

    it('does not read a stall frame as a shortfall', () => {
      const stats = fresh();
      run(stats, 2_000, { speed: 5 });
      // A blocking load that ran a capped handful of steps and discarded the rest of the wall-clock.
      dropped += 50;
      stats.record(sample({ elapsedMs: 3_000, speed: 5, steps: 3, droppedTicks: dropped }));
      for (let ms = 0; ms < 4_000; ms += 250) {
        run(stats, 250, { speed: 5 });
        expect(shortfall(stats)).toBe(false);
      }
    });

    it('holds when the loop drops ticks every frame', () => {
      const stats = fresh();
      run(stats, 2_000, { speed: 5 });
      // Slow frames under a per-frame step cap: part of each frame's due steps discarded.
      run(stats, 2_500, { speed: 5, delivered: 2.5, elapsedMs: 80, dropPerFrame: 2 });
      expect(stats.report().recent.droppedTicks).toBeGreaterThan(0);
      expect(shortfall(stats)).toBe(true);
    });

    it('judges each frame against its own requested speed across a speed change', () => {
      const stats = fresh();
      run(stats, 2_000, { speed: 5 });
      // Dropping back to x1 mid-window delivers x1 at once; the window's average request is not x5.
      run(stats, 400, { speed: 5 });
      run(stats, 3_000, { speed: 1 });
      expect(shortfall(stats)).toBe(false);
    });

    it('keeps its verdict through a pause instead of clearing it for lack of running frames', () => {
      const stats = fresh();
      run(stats, 3_000, { speed: 5, delivered: 3 });
      expect(shortfall(stats)).toBe(true);
      for (let i = 0; i < 180; i++) stats.record(sample({ paused: true, steps: 0, speed: 5 }));
      expect(shortfall(stats)).toBe(true);
    });

    it('clears once the loop keeps up again', () => {
      const stats = fresh();
      run(stats, 3_000, { speed: 5, delivered: 3 });
      expect(shortfall(stats)).toBe(true);
      run(stats, 1_500, { speed: 5 });
      expect(shortfall(stats)).toBe(false);
      expect(stats.sustainedShortfallSpeed()).toBeNull();
    });
  });

  it('lets a recovered stall leave the readout instead of pinning it there for the session', () => {
    const stats = new FrameStats();
    stats.record(sample({ droppedTicks: 40 }));
    expect(stats.report().recent.droppedTicks).toBe(40);
    // The loop stops discarding work. Once the rolling window has turned over, the count must be gone.
    for (let i = 0; i < 200; i++) stats.record(sample({ droppedTicks: 40 }));
    expect(stats.report().recent.droppedTicks).toBe(0);
  });

  it('separates a uniformly slow scene from a spiking one', () => {
    const uniform = new FrameStats();
    for (let i = 0; i < 100; i++) uniform.record(sample({ elapsedMs: 50 }));
    const uniformReport = uniform.report().window.frameMs;
    expect(uniformReport.p99Ms / uniformReport.p50Ms).toBeLessThan(1.5);

    // Three stalls in a hundred frames: a fast scene on a machine that keeps being preempted.
    const spiking = new FrameStats();
    for (let i = 0; i < 97; i++) spiking.record(sample({ elapsedMs: 16 }));
    for (let i = 0; i < 3; i++) spiking.record(sample({ elapsedMs: 800 }));
    const spikingReport = spiking.report().window.frameMs;
    expect(spikingReport.p99Ms / spikingReport.p50Ms).toBeGreaterThan(5);
    expect(spikingReport.maxMs).toBe(800);
  });

  it('keeps the recent averages across a reset, so measuring does not blank the readout', () => {
    const stats = new FrameStats();
    for (let i = 0; i < 30; i++) stats.record(sample({ cpuMs: 10 }));
    stats.reset();
    expect(stats.report().ema.cpuMs).toBeCloseTo(10, 5);
    expect(stats.report().window.frames).toBe(0);
  });

  it('quantizes quantiles to bucket edges rather than retaining every sample', () => {
    const stats = new FrameStats();
    for (let i = 0; i < 200; i++) stats.record(sample({ elapsedMs: 50 }));
    const { p50Ms, maxMs } = stats.report().window.frameMs;
    // Every frame was exactly 50 ms: an implementation keeping samples would answer 50, a bucketed
    // one answers the edge above it. That edge is what makes the fold constant-memory.
    expect(maxMs).toBe(50);
    expect(p50Ms).toBeGreaterThan(50);
    expect(p50Ms).toBeLessThan(50 * 1.15);
  });

  it('still reports after a hundred thousand frames', () => {
    const stats = new FrameStats();
    for (let i = 0; i < 100_000; i++) stats.record(sample({ elapsedMs: 1 + (i % 200) }));
    const report = stats.report();
    expect(report.window.frames).toBe(100_000);
    expect(report.window.frameMs.maxMs).toBe(200);
  });
});
