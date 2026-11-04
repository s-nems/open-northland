import type { FpsLimit } from '../settings/store.js';

export interface RafLoop {
  /** Halt the chain; a second call is a no-op. */
  stop(): void;
  /** Gate the following animation frames by a new cap, its grid anchored on the last drawn frame. */
  setFpsLimit(fpsLimit: FpsLimit): void;
}

export interface RafLoopOptions {
  readonly fpsLimit?: FpsLimit;
  /** Called once, when the animation frame after the first completed `frame` begins: the browser has
   *  presented what that frame drew, first-use GPU work it blocked on included. A hidden page runs no
   *  animation frames, so there it is called at once, after one `frame` outside them if none ran. */
  readonly onFirstFrameShown?: () => void;
  /** Hears what a frame threw, once the loop has stopped for good: a frame that threw midway leaves
   *  the view half updated. Without it the error leaves the animation frame uncaught. */
  readonly onFrameError?: (error: unknown) => void;
}

/** rAF timestamps jitter a few ms around the display's refresh grid; admitting a frame this early
 *  keeps a display that matches the cap from losing every borderline frame to the gate. */
const EARLY_FRAME_TOLERANCE_MS = 4;
/** How far each admitted frame may pull the cap's grid toward its own timestamp. A display a fraction
 *  of a percent off a multiple of the cap (119.88 Hz under 60) then stays locked to every n-th refresh
 *  instead of drifting through the grid and drawing one refresh early, then one late, every second; the
 *  admitted rate stays within 0.6% of the cap. */
const GRID_SLEW_MS = 0.1;

/**
 * Wall-clock gate for a drawn-frame cap: `null` admits every animation frame. Due times advance
 * along the cap's own grid rather than from each admitted timestamp, so the admitted rate averages
 * the cap even when the display rate is not a multiple of it; each admitted frame slews the grid by
 * at most {@link GRID_SLEW_MS} toward itself. Given the last frame drawn before it, the grid starts one
 * interval after that frame; without one, the first frame draws and anchors it.
 */
export function createFrameLimiter(
  fpsLimit: FpsLimit,
  lastDrawnMs: number | null = null,
): (nowMs: number) => boolean {
  if (fpsLimit === null) return () => true;
  const intervalMs = 1000 / fpsLimit;
  let nextDueMs = lastDrawnMs === null ? null : lastDrawnMs + intervalMs;
  return (nowMs) => {
    if (nextDueMs !== null && nowMs < nextDueMs - EARLY_FRAME_TOLERANCE_MS) return false;
    if (nextDueMs === null || nowMs - nextDueMs > intervalMs) {
      // More than a whole interval past due is a stall: re-anchor the grid instead of replaying it.
      nextDueMs = nowMs + intervalMs;
    } else {
      const slewedMs = Math.min(nextDueMs + GRID_SLEW_MS, Math.max(nextDueMs - GRID_SLEW_MS, nowMs));
      nextDueMs = slewedMs + intervalMs;
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
  let admits = createFrameLimiter(options.fpsLimit ?? null);
  let lastDrawnMs: number | null = null;
  let running = true;
  let drawn = false;
  let shown = false;
  let rafId = 0;
  const { onFrameError } = options;
  const draw = (nowMs: number): void => {
    lastDrawnMs = nowMs;
    if (onFrameError === undefined) frame(nowMs);
    else {
      try {
        frame(nowMs);
      } catch (error) {
        stop();
        onFrameError(error);
        return;
      }
    }
    drawn = true;
  };
  const markShown = (): void => {
    shown = true;
    stopWatchingHidden();
    options.onFirstFrameShown?.();
  };
  // A hidden page runs no animation frames, so its first frame would never count as shown; the one
  // frame drawn here starts the world, which the display then stops taking until the page shows.
  const whenHidden = (): void => {
    if (!running || shown || !document.hidden) return;
    if (!drawn) draw(performance.now());
    if (running && !shown) markShown();
  };
  const watchesHidden = options.onFirstFrameShown !== undefined && typeof document !== 'undefined';
  const stopWatchingHidden = (): void => {
    if (watchesHidden) document.removeEventListener('visibilitychange', whenHidden);
  };
  if (watchesHidden) {
    document.addEventListener('visibilitychange', whenHidden);
    queueMicrotask(whenHidden);
  }
  function stop(): void {
    running = false;
    stopWatchingHidden();
    cancelAnimationFrame(rafId);
  }
  rafId = requestAnimationFrame(function tick(nowMs) {
    if (!running) return;
    if (drawn && !shown) markShown();
    if (admits(nowMs)) draw(nowMs);
    // `frame` may have stopped the loop, so re-check before rescheduling.
    if (running) rafId = requestAnimationFrame(tick);
  });
  return {
    stop,
    setFpsLimit(fpsLimit): void {
      admits = createFrameLimiter(fpsLimit, lastDrawnMs);
    },
  };
}
