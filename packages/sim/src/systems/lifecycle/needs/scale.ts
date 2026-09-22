import { type Fixed, fx, ONE } from '../../../core/fixed.js';

// The need reserve: the integer scale `atomicanimations.ini` writes its need events on, and the levels
// the drives read off it. A sim need is the deficit against this reserve, in [NEED_OVERFILL_FLOOR, ONE].

/**
 * One full need bar in `atomicanimations.ini` event units - the span every `event <at> <channel> <delta>`
 * tuple moves a need against. Byte evidence: the original carries a four-row level table, one column per
 * need, whose maximum row reads 10000.
 */
export const NEED_RESERVE_UNITS = 10000;

/**
 * Reserve units a settler's hunger, rest and company bars lose per tick on their own. Source basis:
 * observation of the running original, where an idle bar loses 10% per 80 s at 1x - one unit per 12 Hz
 * tick. The fixed-point quantum truncates a little under that, so the modelled bar outlasts the observed
 * one by about a tenth.
 */
export const NEED_DRAIN_UNITS_PER_TICK = 1;

/**
 * The three levels the drives read off the reserve, the table's remaining rows. Byte evidence: the original
 * drops a settler's work below 2001, tops a bar up at home below 8001, and marks a need
 * for the player below 1001.
 */
export const NEED_DRIVE_UNITS = 2000;
export const NEED_SATED_UNITS = 8000;
export const NEED_CRITICAL_UNITS = 1000;

/** The reserve a bar banks above full. Byte evidence: the original caps each need at its own maximum plus
 *  half again, computed off the table rather than authored as a level of its own. */
export const NEED_OVERFILL_UNITS = NEED_RESERVE_UNITS / 2;

/** Reserve units as a fraction of a full bar. */
export function needBar(units: number): Fixed {
  return fx.div(fx.fromInt(units), fx.fromInt(NEED_RESERVE_UNITS));
}

/** The deficit a settler sitting at `satisfaction` reserve units carries. */
function deficitAt(satisfaction: number): Fixed {
  return needBar(NEED_RESERVE_UNITS - satisfaction);
}

/** Deficit at or above which a drive fires ({@link NEED_DRIVE_UNITS}); the same level for every need. */
export const NEED_DRIVE_THRESHOLD: Fixed = deficitAt(NEED_DRIVE_UNITS);

/** Deficit at or below which a need counts as served ({@link NEED_SATED_UNITS}) - the at-home top-up target. */
export const NEED_SATED_THRESHOLD: Fixed = deficitAt(NEED_SATED_UNITS);

/** Deficit at or above which the HUD marks the need ({@link NEED_CRITICAL_UNITS}). */
export const NEED_CRITICAL_THRESHOLD: Fixed = deficitAt(NEED_CRITICAL_UNITS);

/** The most overfilled a bar goes ({@link NEED_OVERFILL_UNITS}); a deficit below zero is stored reserve. */
export const NEED_OVERFILL_FLOOR: Fixed = fx.sub(fx.fromInt(0), needBar(NEED_OVERFILL_UNITS));

/** Hold a need inside `[NEED_OVERFILL_FLOOR, ONE]`. */
export function clampNeed(deficit: Fixed): Fixed {
  if (deficit < NEED_OVERFILL_FLOOR) return NEED_OVERFILL_FLOOR;
  if (deficit > ONE) return ONE;
  return deficit;
}

/** Move a need by `units` of the reserve, in the data's own sign: a clip's `+4000` serves the need and a
 *  work clip's `-100` drains it. */
export function applyNeedUnits(deficit: Fixed, units: number): Fixed {
  return clampNeed(fx.sub(deficit, needBar(units)));
}
