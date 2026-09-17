import type { Rect } from './geometry.js';

/**
 * The bottom navigation beam's design-px box (FOUNDATION.md): seven 76 × 90 actions with 3 px gaps on
 * a beam padded 8 / 12 / 4 px. The numbers mirror `.on-beam` and `.on-action` in `dom/foundation.css`.
 */
const NAV_ACTION_W = 76;
const NAV_ACTION_H = 90;
const NAV_ACTION_GAP = 3;
const NAV_ENTRIES = 7;
const NAV_PAD_X = 12;
const NAV_PAD_TOP = 8;
const NAV_PAD_BOTTOM = 4;
export const NAV_BEAM_W = NAV_ENTRIES * NAV_ACTION_W + (NAV_ENTRIES - 1) * NAV_ACTION_GAP + 2 * NAV_PAD_X;
export const NAV_BEAM_H = NAV_ACTION_H + NAV_PAD_TOP + NAV_PAD_BOTTOM;

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/** The beam's screen rect at a HUD scale: centred on the bottom edge. */
export function navBeamRect(screen: ScreenSize, scale: number): Rect {
  const w = NAV_BEAM_W * scale;
  const h = NAV_BEAM_H * scale;
  return { x: Math.round((screen.width - w) / 2), y: screen.height - h, w, h };
}
