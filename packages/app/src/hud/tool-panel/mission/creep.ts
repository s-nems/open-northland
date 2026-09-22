/**
 * The descent an opened mission sheet reads itself with: after a pause it walks down at a fixed rate
 * until the player takes the scroll. Byte evidence from the owned copy: the only 7.2f constant is
 * passed with a 1000 ms delay, behind the flag that arms the hypertext element. That the element then
 * positions the page at `rate * (elapsed - delay)` is unconfirmed against the running original.
 */

export const AUTO_SCROLL_DELAY_MS = 1000;
/** Design px per second, so the screen rate follows the window's scale. */
export const AUTO_SCROLL_PX_PER_S = 7.2;
/** A longer frame gap is time the sheet spent unwatched (a hidden tab), not reading time. */
export const MAX_CREEP_STEP_MS = 250;
const MS_PER_S = 1000;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches;
}

export interface SheetCreep {
  /** Where the page sits after this frame's time, in screen px. */
  advance(now: number, scale: number): number;
}

/** Null when the viewer asked for reduced motion. */
export function startCreep(now: number): SheetCreep | null {
  if (prefersReducedMotion()) return null;
  let elapsed = 0;
  let last = now;
  return {
    advance(at, scale) {
      elapsed += Math.min(Math.max(0, at - last), MAX_CREEP_STEP_MS);
      last = at;
      const running = elapsed - AUTO_SCROLL_DELAY_MS;
      return running <= 0 ? 0 : (AUTO_SCROLL_PX_PER_S * running * scale) / MS_PER_S;
    },
  };
}
