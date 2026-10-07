import type { FpsLimit } from '../settings-store.js';

export interface RafLoop {
  /** Halt the chain; a second call is a no-op. */
  stop(): void;
}

export interface RafLoopOptions {
  readonly fpsLimit?: FpsLimit;
  /** Called once, when the animation frame after the first completed `frame` begins: the browser has
   *  presented what that frame drew, first-use GPU work it blocked on included. */
  readonly onFirstFrameShown?: () => void;
}

/** rAF timestamps jitter a few ms around the display's refresh grid; admitting a frame this early
 *  keeps a display that matches the cap from losing every borderline frame to the gate. */
const EARLY_FRAME_TOLERANCE_MS = 4;

/**
 * Wall-clock gate for a drawn-frame cap: `null` admits every animation frame. Due times advance
 * along the cap's own grid rather than from each admitted timestamp, so the admitted rate averages
 * the cap even when the display rate is not a multiple of it.
 */
export function createFrameLimiter(fpsLimit: FpsLimit): (nowMs: number) => boolean {
  if (fpsLimit === null) return () => true;
  const intervalMs = 1000 / fpsLimit;
  let nextDueMs: number | null = null;
  return (nowMs) => {
    if (nextDueMs !== null && nowMs < nextDueMs - EARLY_FRAME_TOLERANCE_MS) return false;
    if (nextDueMs === null || nowMs - nextDueMs > intervalMs) {
      // More than a whole interval past due is a stall: re-anchor the grid instead of replaying it.
      nextDueMs = nowMs + intervalMs;
    } else {
      nextDueMs += intervalMs;
    }
    return true;
  };
}

/**
 * Drive `frame` once per animation frame, or at most `fpsLimit` times a second when one is set. A
 * skipped frame still reschedules, so the fixed timestep catches up on the next admitted frame. The
 * chain reschedules itself, so {@link RafLoop.stop} is the only thing that ends it: a session that
 * never stops leaves a second loop stepping the same stage.
 */
export function startRafLoop(frame: (nowMs: number) => void, options: RafLoopOptions = {}): RafLoop {
  const admits = createFrameLimiter(options.fpsLimit ?? null);
  let running = true;
  let drawn = false;
  let shown = false;
  let rafId = requestAnimationFrame(function tick(nowMs) {
    if (!running) return;
    if (drawn && !shown) {
      shown = true;
      options.onFirstFrameShown?.();
    }
    if (admits(nowMs)) {
      frame(nowMs);
      drawn = true;
    }
    // `frame` may have stopped the loop, so re-check before rescheduling.
    if (running) rafId = requestAnimationFrame(tick);
  });
  return {
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
