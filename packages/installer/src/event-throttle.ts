/** Minimum ms between forwarded progress events; an approximation below notice on a progress bar. */
const EVENT_INTERVAL_MS = 100;

export interface EventThrottle {
  /** Whether to forward this event now; `final` events always pass and restart the interval. */
  shouldEmit(final: boolean): boolean;
  /** Drop the interval so the next event passes. */
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
