/**
 * The descent an opened mission sheet reads itself with: after a pause it walks down at a fixed rate
 * until the player takes the scroll. Byte evidence from the owned copy's `the original`: the only 7.2f
 * in the image (`data` 0x4F22FC) is pushed with a 1000 ms delay at 0x4A3E2C, behind the flag that
 * arms the hypertext element, and the element positions the page at `rate * (elapsed - delay)`.
 */

export const AUTO_SCROLL_DELAY_MS = 1000;
/** Design px per second, so the screen rate follows the window's scale. */
export const AUTO_SCROLL_PX_PER_S = 7.2;
/** A longer frame gap is time the sheet spent unwatched (a hidden tab), not reading time. */
export const MAX_CREEP_STEP_MS = 250;
const MS_PER_S = 1000;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Motion the player did not ask for, so a system that wants less does not get it. */
function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches;
}

export interface SheetCreep {
  /** Take the frame's own time and answer where the page should sit, in screen px. */
  advance(now: number, scale: number): number;
}

/** The creep an opening sheet starts, or null when the viewer asked for reduced motion. */
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
