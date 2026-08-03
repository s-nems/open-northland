export interface RafLoop {
  /** Halt the chain; a second call is a no-op. */
  stop(): void;
}

/**
 * Drive `frame` once per animation frame. The chain reschedules itself, so {@link RafLoop.stop} is the
 * only thing that ends it: a session that never stops leaves a second loop stepping the same stage.
 */
export function startRafLoop(frame: (nowMs: number) => void): RafLoop {
  let running = true;
  let rafId = requestAnimationFrame(function tick(nowMs) {
    if (!running) return;
    frame(nowMs);
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
