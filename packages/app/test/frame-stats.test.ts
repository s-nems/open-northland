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
    const running = stats.report().ema.deliveredSpeed;
    for (let i = 0; i < 20; i++) stats.record(sample({ paused: true, steps: 0 }));
    expect(stats.report().ema.deliveredSpeed).toBe(running);
  });

  it('derives the window drop count from the monotonic session total', () => {
    const stats = new FrameStats();
    stats.record(sample({ droppedTicks: 40 }));
    stats.reset();
    stats.record(sample({ droppedTicks: 55 }));
    expect(stats.report().window.droppedTicks).toBe(15);
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

  it('costs the same memory for a long session as a short one', () => {
    const stats = new FrameStats();
    for (let i = 0; i < 100_000; i++) stats.record(sample({ elapsedMs: 1 + (i % 200) }));
    // The distribution is a fixed bucket array, so a 100k-frame session still answers instantly.
    const report = stats.report();
    expect(report.window.frames).toBe(100_000);
    expect(report.window.frameMs.maxMs).toBe(200);
  });
});
