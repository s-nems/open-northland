// Job efficiency: how a worker's experience percent and worn tool turn into strokes and build steps.
// Original behavior throughout; every division truncates.

const PERCENT = 100;

/** Experience percent that saves one stroke per unit: a master saves five. */
const EXPERIENCE_PCT_PER_SAVED_STROKE = 20;

/**
 * Strokes (chops, strikes, casts) one unit costs a worker: the trade's base count, divided by the tool's
 * work factor, less one stroke per twenty experience percent, never below one. A master with an iron tool
 * clears a ten-stroke unit in one.
 */
export function strokesPerUnit(base: number, experiencePct: number, toolWorkFactorPct: number): number {
  const withTool = Math.trunc((base * PERCENT) / toolWorkFactorPct);
  return Math.max(1, withTool - Math.trunc(experiencePct / EXPERIENCE_PCT_PER_SAVED_STROKE));
}

/** The percent a bare-handed novice's build swing is worth: one step, and a second from 50 percent
 *  experience on. */
const BUILD_SWING_BASE_PCT = 150;

/**
 * Construction steps one hammer swing installs: `(150 + experience percent)`, scaled by the tool's work
 * factor, in whole hundreds. One or two steps bare-handed, up to three with a wooden tool, two to four
 * with an iron one.
 */
export function buildStepsPerSwing(experiencePct: number, toolWorkFactorPct: number): number {
  const scaled = Math.trunc(((BUILD_SWING_BASE_PCT + experiencePct) * toolWorkFactorPct) / PERCENT);
  return Math.trunc(scaled / PERCENT);
}
