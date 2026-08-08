import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameLimiter, type RafLoop, startRafLoop } from '../src/view/runtime/raf-loop.js';

/**
 * A controllable `requestAnimationFrame`: queued callbacks fire only when the test flushes, so the
 * loop's start/stop lifecycle is deterministic (no real animation clock in the node test env).
 */
function fakeRaf(): {
  raf: (cb: (nowMs: number) => void) => number;
  caf: (id: number) => void;
  flush: (nowMs?: number) => void;
  pending: () => number;
} {
  let nextId = 1;
  const queue = new Map<number, (nowMs: number) => void>();
  return {
    raf: (cb) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id) => {
      queue.delete(id);
    },
    // Fire the currently-pending callbacks once; a callback may enqueue the next frame (which this
    // flush does NOT run - one flush = one animation frame).
    flush: (nowMs = 0) => {
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb(nowMs);
    },
    pending: () => queue.size,
  };
}

describe('startRafLoop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drives the frame once per animation frame until stopped, then cancels the pending frame', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);

    let frames = 0;
    const loop = startRafLoop(() => {
      frames++;
    });

    clock.flush(); // frame 1 (reschedules itself)
    clock.flush(); // frame 2 (reschedules itself)
    expect(frames).toBe(2);
    expect(clock.pending()).toBe(1); // the loop keeps exactly one frame queued

    loop.stop();
    expect(clock.pending()).toBe(0); // the queued frame was cancelled

    clock.flush(); // nothing left to run
    expect(frames).toBe(2); // no frame ran after stop
  });

  it('halts when the frame body stops the loop mid-frame (a quit issued during a frame)', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);

    let frames = 0;
    let loop: RafLoop | undefined;
    loop = startRafLoop(() => {
      frames++;
      loop?.stop();
    });

    clock.flush();
    expect(frames).toBe(1);
    expect(clock.pending()).toBe(0); // the frame that stopped itself did not reschedule

    clock.flush();
    expect(frames).toBe(1);
  });

  it('stop() is idempotent', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);

    const loop = startRafLoop(() => undefined);
    expect(() => {
      loop.stop();
      loop.stop();
    }).not.toThrow();
  });

  it('skips gated frames but keeps rescheduling, so the chain survives a cap', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);

    const frames: number[] = [];
    const loop = startRafLoop((nowMs) => frames.push(nowMs), 30);
    // A 60 Hz display: every other frame passes a 30 FPS cap.
    for (let tick = 0; tick < 6; tick++) clock.flush(tick * (1000 / 60));
    expect(frames).toEqual([0, 1000 / 30, 2000 / 30]);
    expect(clock.pending()).toBe(1);
    loop.stop();
  });
});

/** Timestamps of the admitted frames when `ticks` animation frames arrive `stepMs` apart. */
function admitted(limiter: (nowMs: number) => boolean, stepMs: number, ticks: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const nowMs = i * stepMs;
    if (limiter(nowMs)) out.push(nowMs);
  }
  return out;
}

describe('createFrameLimiter', () => {
  const HZ_60 = 1000 / 60;
  const HZ_120 = 1000 / 120;
  const HZ_144 = 1000 / 144;

  it('admits every frame without a cap', () => {
    const limiter = createFrameLimiter(null);
    expect(admitted(limiter, HZ_60, 5)).toHaveLength(5);
  });

  it('halves a 60 Hz display to a 30 FPS cap', () => {
    const limiter = createFrameLimiter(30);
    expect(admitted(limiter, HZ_60, 8)).toEqual([0, 2, 4, 6].map((i) => i * HZ_60));
  });

  it('admits every 60 Hz frame under a 60 FPS cap despite timestamp jitter', () => {
    const limiter = createFrameLimiter(60);
    let admittedCount = 0;
    for (let i = 0; i < 60; i++) {
      // Alternating ±1 ms jitter around the display grid stays inside the early tolerance.
      const jitter = i % 2 === 0 ? -1 : 1;
      if (limiter(i * HZ_60 + (i === 0 ? 0 : jitter))) admittedCount++;
    }
    expect(admittedCount).toBe(60);
  });

  it('halves a 120 Hz display to a 60 FPS cap', () => {
    const limiter = createFrameLimiter(60);
    const frames = admitted(limiter, HZ_120, 20);
    expect(frames).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18].map((i) => i * HZ_120));
  });

  it('averages the cap on a display rate that is not a multiple of it', () => {
    const limiter = createFrameLimiter(60);
    // One second of 144 Hz frames: the admitted count must sit at the cap, not at 144/2 or 144/3.
    const frames = admitted(limiter, HZ_144, 145);
    expect(frames.length).toBeGreaterThanOrEqual(59);
    expect(frames.length).toBeLessThanOrEqual(61);
  });

  it('resumes paced after a stall instead of bursting to catch up', () => {
    const limiter = createFrameLimiter(30);
    expect(limiter(0)).toBe(true);
    // A long hitch: the backlog is discarded, the next frame renders, and pacing continues.
    expect(limiter(500)).toBe(true);
    expect(limiter(500 + HZ_60)).toBe(false);
    expect(limiter(500 + 2 * HZ_60)).toBe(true);
  });
});
