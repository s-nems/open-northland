/**
 * Artistic approximation, independent of sim state: a ship at sea rolls (a shear about its keel) and
 * heaves (a pixel lift) on a slow swell, harder under sail; the original draws its ships rigid, and a
 * moored ship lies still here too. Periods are sim ticks (12 Hz).
 */

const ROLL_PERIOD_TICKS = 44;
const HEAVE_PERIOD_TICKS = 28;
const SAILING_ROLL = 0.035;
const SAILING_HEAVE_PX = 2;
const AT_SEA_ROLL = 0.015;
const AT_SEA_HEAVE_PX = 1;
/** Per-anchor phase offsets, radians per world pixel, so a fleet never rocks in step. */
const PHASE_PER_X = 0.013;
const PHASE_PER_Y = 0.009;
const TAU = Math.PI * 2;

export interface ShipSway {
  /** The roll, as the vegetation shear: the mast leans, the keel stays. */
  readonly shear: number;
  /** The heave, in world pixels, negative upward. */
  readonly dy: number;
}

export function shipSway(tick: number, x: number, y: number, underSail: boolean): ShipSway {
  const phase = x * PHASE_PER_X + y * PHASE_PER_Y;
  const roll = underSail ? SAILING_ROLL : AT_SEA_ROLL;
  const heave = underSail ? SAILING_HEAVE_PX : AT_SEA_HEAVE_PX;
  return {
    shear: roll * Math.sin((tick / ROLL_PERIOD_TICKS) * TAU + phase),
    dy: -heave * Math.abs(Math.sin((tick / HEAVE_PERIOD_TICKS) * TAU + phase)),
  };
}
