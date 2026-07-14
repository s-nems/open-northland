/** A running `requestAnimationFrame` chain with a stop seam. */
export interface RafLoop {
  /** Halt the chain: no further frames run. Idempotent — a second call is a no-op. */
  stop(): void;
}

/**
 * Drive `frame` once per animation frame until stopped. The chain reschedules itself, so the sole owner
 * of the loop's lifetime is the returned {@link RafLoop.stop} — a game session calls it on quit so a
 * later game can start without a second loop stepping the same stage (see view/game-view.ts). Split out
 * from the per-frame body (frame-loop.ts) so the start/stop lifecycle is unit-testable on its own.
 */
export function startRafLoop(frame: (nowMs: number) => void): RafLoop {
  let running = true;
  let rafId = requestAnimationFrame(function tick(nowMs) {
    if (!running) return;
    frame(nowMs);
    // Re-check after the frame: `frame` may have stopped the loop (a quit issued mid-frame).
    if (running) rafId = requestAnimationFrame(tick);
  });
  return {
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
