import { gradeLuma, type LightGrade, nightLevel } from '@open-northland/render/data';
import { TICKS_PER_SECOND } from '@open-northland/sim';

/** Palette indices of the day the shipped cycling maps step through (`docs/formats/SCRIPT-TINTS.md`). */
const DAY = 0;
const MORNING_SUN = 125;
const NOON_SUN = 124;
const LOW_SUN = 126;
const SUNSET = 64;
const DEEP_SUNSET = 79;
const EVENING = 133;
const NIGHT = 58;

/** One step of a cycle: a palette index held for `seconds` of match time. */
export interface CycleStep {
  readonly index: number;
  readonly seconds: number;
}

/** The game's own cycle: straznicypolnocy's chain, step for step, a 50-minute day. */
const CYCLE: readonly CycleStep[] = [
  { index: DAY, seconds: 600 },
  { index: MORNING_SUN, seconds: 360 },
  { index: NOON_SUN, seconds: 360 },
  { index: LOW_SUN, seconds: 360 },
  { index: SUNSET, seconds: 180 },
  { index: DEEP_SUNSET, seconds: 180 },
  { index: EVENING, seconds: 240 },
  { index: NIGHT, seconds: 600 },
  { index: EVENING, seconds: 120 },
];

const CYCLE_SECONDS = CYCLE.reduce((sum, step) => sum + step.seconds, 0);

/** The cycle's step at match tick `tick`, starting at daybreak; the same object for a whole step. */
export function cycleStepAtTick(tick: number): CycleStep {
  let at = (tick / TICKS_PER_SECOND) % CYCLE_SECONDS;
  for (const step of CYCLE) {
    if (at < step.seconds) return step;
    at -= step.seconds;
  }
  return CYCLE[0] as CycleStep;
}

/** A shipped script's whole-map write is a disc of at least this range; a local one stays below. */
const WHOLE_MAP_RANGE = 255;
/** `nightLevel` of a full night. */
const FULL_NIGHT = 1;

export interface ScriptedCycleProbe {
  readonly range: number;
  readonly index: number;
}

/**
 * Whether a script runs a day and night of its own: its whole-map writes reach both a full night and
 * a sun brighter than plain day. A single dark write is a cave's static mood, a weather ramp's rain
 * darkens without a sun and its clearing brightens without a night; those stay when a match turns the
 * cycle off.
 */
export function scriptsDayNightCycle(
  ops: readonly ScriptedCycleProbe[],
  gradeOf: (index: number) => LightGrade | null,
): boolean {
  let night = false;
  let sun = false;
  for (const op of ops) {
    if (op.range < WHOLE_MAP_RANGE) continue;
    const grade = gradeOf(op.index);
    if (grade === null) continue;
    if (nightLevel(grade) >= FULL_NIGHT) night = true;
    if (gradeLuma(grade) > 1) sun = true;
  }
  return night && sun;
}

/**
 * Whether a script setting weather also moves the whole map's tint with it. A colour written once is
 * the map's look, whatever else the script does.
 */
export function scriptsWeatherTints(ops: readonly ScriptedCycleProbe[], palette: readonly number[]): boolean {
  const colors = new Set(ops.filter((op) => op.range >= WHOLE_MAP_RANGE).map((op) => palette[op.index]));
  return colors.size > 1;
}
