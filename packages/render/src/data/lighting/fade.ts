import { WEATHER_SNAP_SECONDS } from '../weather/climate.js';
import type { LightGrade } from './types.js';

/** Game seconds a step in the scene grade takes to settle (about 95% of the way). */
export const LIGHT_FADE_SECONDS = 4;
/** An exponential fade closes 1 - e^-3, about 95%, of the gap in three time constants. */
const FADE_TIME_CONSTANTS = 3;
/** Closer than one 8-bit colour step to the target snaps onto it, so a fade ends on exact daylight and
 *  the pass can rest. */
const SETTLE_EPSILON = 1 / 255;

/**
 * Move `grade` toward `target` over `dt` game seconds, exponentially. A pause (`dt` 0) holds it; a step
 * back or longer than {@link WEATHER_SNAP_SECONDS} (a load, a seek, a catch-up) snaps, like the weather.
 */
export function fadeGrade(grade: [number, number, number], target: LightGrade, dt: number): void {
  const snap = dt < 0 || dt > WEATHER_SNAP_SECONDS;
  const k = snap ? 1 : 1 - Math.exp((-dt * FADE_TIME_CONSTANTS) / LIGHT_FADE_SECONDS);
  grade[0] = approach(grade[0], target[0], k);
  grade[1] = approach(grade[1], target[1], k);
  grade[2] = approach(grade[2], target[2], k);
}

function approach(from: number, to: number, k: number): number {
  const next = from + (to - from) * k;
  return Math.abs(to - next) < SETTLE_EPSILON ? to : next;
}
