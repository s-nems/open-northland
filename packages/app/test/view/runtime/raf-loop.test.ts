import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameLimiter, type RafLoop, startRafLoop } from '../../../src/view/runtime/raf-loop.js';

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

  it('stops for good on a frame that throws and hands the error to its handler once', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);
    const thrown = new Error('frame broke');
    const heard: unknown[] = [];
    let frames = 0;
    startRafLoop(
      () => {
        frames++;
        throw thrown;
      },
      { onFrameError: (error) => heard.push(error) },
    );
    clock.flush();
    clock.flush();
    expect({ frames, heard, pending: clock.pending() }).toEqual({ frames: 1, heard: [thrown], pending: 0 });
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

  it('skips gated frames but keeps rescheduling, so the chain survives a cap', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);

    const frames: number[] = [];
    const loop = startRafLoop((nowMs) => frames.push(nowMs), { fpsLimit: 30 });
    // A 60 Hz display: every other frame passes a 30 FPS cap.
    for (let tick = 0; tick < 6; tick++) clock.flush(tick * (1000 / 60));
    expect(frames).toEqual([0, 1000 / 30, 2000 / 30]);
    expect(clock.pending()).toBe(1);
    loop.stop();
  });

  it('gates the following frames by a cap replaced while the loop runs', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);

    const frames: number[] = [];
    const loop = startRafLoop((nowMs) => frames.push(nowMs), { fpsLimit: null });
    const at = (frame: number): number => frame * (1000 / 60);
    // A 60 Hz display drawn uncapped, then held to 30 FPS, then let go again. The cap's grid runs on
    // from the last frame drawn, so the first capped frame waits a whole 30 FPS interval.
    for (let frame = 0; frame < 2; frame++) clock.flush(at(frame));
    loop.setFpsLimit(30);
    for (let frame = 2; frame < 6; frame++) clock.flush(at(frame));
    loop.setFpsLimit(null);
    for (let frame = 6; frame < 8; frame++) clock.flush(at(frame));
    expect(frames).toEqual([0, 1, 3, 5, 6, 7].map(at));
    loop.stop();
  });

  it('draws no extra frame when the same cap is set again, as a restore of defaults does', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);

    const frames: number[] = [];
    const loop = startRafLoop((nowMs) => frames.push(nowMs), { fpsLimit: 30 });
    const at = (frame: number): number => frame * (1000 / 60);
    for (let frame = 0; frame < 3; frame++) clock.flush(at(frame));
    loop.setFpsLimit(30);
    for (let frame = 3; frame < 6; frame++) clock.flush(at(frame));
    expect(frames).toEqual([0, 2, 4].map(at));
    loop.stop();
  });

  it('reports the first frame shown once the animation frame after the first drawn one begins', () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);

    const shown = vi.fn();
    const loop = startRafLoop(() => undefined, { fpsLimit: 30, onFirstFrameShown: shown });
    clock.flush(0); // the first frame draws, and may block on its first draw until it returns
    expect(shown).not.toHaveBeenCalled();
    clock.flush(1000 / 60); // the next animation frame, gated or not, means the first was presented
    expect(shown).toHaveBeenCalledOnce();
    clock.flush(1000 / 30);
    expect(shown).toHaveBeenCalledOnce();
    loop.stop();
  });

  it('reports the first frame shown at once on a page hidden before it, drawing that frame itself', async () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);
    const page = fakeDocument(true);
    vi.stubGlobal('document', page);

    let frames = 0;
    const shown = vi.fn();
    const loop = startRafLoop(() => frames++, { onFirstFrameShown: shown });
    await Promise.resolve();
    // No animation frame ran: a hidden page gets none until it is shown again.
    expect(frames).toBe(1);
    expect(shown).toHaveBeenCalledOnce();
    expect(page.listeners()).toBe(0);
    clock.flush(0);
    clock.flush(1000 / 60);
    expect(shown).toHaveBeenCalledOnce();
    loop.stop();
  });

  it('reports a drawn first frame shown when the page hides before presenting it', async () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);
    const page = fakeDocument(false);
    vi.stubGlobal('document', page);

    let frames = 0;
    const shown = vi.fn();
    const loop = startRafLoop(() => frames++, { onFirstFrameShown: shown });
    await Promise.resolve();
    expect(shown).not.toHaveBeenCalled();
    clock.flush(0);
    page.hide();
    expect(frames).toBe(1);
    expect(shown).toHaveBeenCalledOnce();
    loop.stop();
  });

  it('stops watching the page once stopped, so a later hide draws nothing', async () => {
    const clock = fakeRaf();
    vi.stubGlobal('requestAnimationFrame', clock.raf);
    vi.stubGlobal('cancelAnimationFrame', clock.caf);
    const page = fakeDocument(false);
    vi.stubGlobal('document', page);

    const frame = vi.fn();
    const shown = vi.fn();
    startRafLoop(frame, { onFirstFrameShown: shown }).stop();
    expect(page.listeners()).toBe(0);
    page.hide();
    await Promise.resolve();
    expect(frame).not.toHaveBeenCalled();
    expect(shown).not.toHaveBeenCalled();
  });
});

/** The part of `document` the loop reads: whether the page is hidden, and its visibility event. */
function fakeDocument(hidden: boolean): {
  hidden: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  hide: () => void;
  listeners: () => number;
} {
  const listeners = new Set<() => void>();
  const page = {
    hidden,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    hide: () => {
      page.hidden = true;
      for (const listener of [...listeners]) listener();
    },
    listeners: () => listeners.size,
  };
  return page;
}

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
  const HZ_144 = 1000 / 144;

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

  it('averages the cap on a display rate that is not a multiple of it', () => {
    const limiter = createFrameLimiter(60);
    // One second of 144 Hz frames: the admitted count must sit at the cap, not at 144/2 or 144/3.
    const frames = admitted(limiter, HZ_144, 145);
    expect(frames.length).toBeGreaterThanOrEqual(59);
    expect(frames.length).toBeLessThanOrEqual(61);
  });

  it.each([119.88, 120.5])('draws every second refresh of a %s Hz display under a 60 FPS cap', (hz) => {
    const limiter = createFrameLimiter(60);
    const refreshMs = 1000 / hz;
    const frames = admitted(limiter, refreshMs, Math.round(hz * 10));
    const refreshesApart = frames
      .slice(1)
      .map((nowMs, i) => Math.round((nowMs - (frames[i] ?? Number.NaN)) / refreshMs));
    expect(new Set(refreshesApart)).toEqual(new Set([2]));
  });

  it('admits every frame on a display slower than the cap', () => {
    const limiter = createFrameLimiter(30);
    expect(admitted(limiter, 1000 / 24, 24)).toHaveLength(24);
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
