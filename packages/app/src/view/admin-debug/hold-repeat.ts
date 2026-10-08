/** How long a press must be held before it repeats, so a plain click still drops exactly one. */
export const HOLD_REPEAT_DELAY_MS = 300;
/** The gap between repeats while the press stays down. */
export const HOLD_REPEAT_INTERVAL_MS = 100;

export interface HoldRepeat {
  /** Begin repeating `fire` after the hold delay; replaces any repeat already running. */
  start(fire: () => void): void;
  stop(): void;
}

export function createHoldRepeat(): HoldRepeat {
  let delay: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    clearTimeout(delay);
    clearInterval(interval);
    delay = undefined;
    interval = undefined;
  };
  return {
    start(fire): void {
      stop();
      delay = setTimeout(() => {
        delay = undefined;
        fire();
        interval = setInterval(fire, HOLD_REPEAT_INTERVAL_MS);
      }, HOLD_REPEAT_DELAY_MS);
    },
    stop,
  };
}
