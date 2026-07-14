import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RafLoop, startRafLoop } from '../src/view/raf-loop.js';

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
    // flush does NOT run — one flush = one animation frame).
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
});
