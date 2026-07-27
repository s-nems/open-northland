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

  it('waits for a second dropping window before calling a shortfall sustained', () => {
    const stats = new FrameStats();
    // A hitch confined to one window: real, over, and not a claim about how the loop is keeping up.
    for (let i = 0; i < 12; i++) stats.record(sample({ elapsedMs: 80, droppedTicks: i < 6 ? i : 6 }));
    for (let i = 0; i < 25; i++) stats.record(sample({ elapsedMs: 80, droppedTicks: 6 }));
    expect(stats.report().recent.sustainedShortfall).toBe(false);
    // Dropping every frame from here: two consecutive windows, so the loop really is losing ground.
    for (let i = 0; i < 50; i++) stats.record(sample({ elapsedMs: 80, steps: 5, droppedTicks: 6 + i }));
    expect(stats.report().recent.sustainedShortfall).toBe(true);
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
