/**
 * Rate-limits the shell's progress streams, which tick far faster than a bar can use: the pipeline's
 * unpack stage reports thousands of items per second and the mod installer ticks per downloaded
 * chunk.
 */

/** Minimum ms between forwarded progress events; ~one UI frame's worth, well under human notice. */
const EVENT_INTERVAL_MS = 100;

export interface EventThrottle {
  /** Whether to forward this event now; `final` events always pass and restart the interval. */
  shouldEmit(final: boolean): boolean;
  /** Drop the interval so the next event passes — a new stage starts its own stream. */
  reset(): void;
}

export function createEventThrottle(): EventThrottle {
  let lastEmit = 0;
  return {
    shouldEmit(final: boolean): boolean {
      const now = Date.now();
      if (!final && now - lastEmit < EVENT_INTERVAL_MS) return false;
      lastEmit = now;
      return true;
    },
    reset(): void {
      lastEmit = 0;
    },
  };
}
