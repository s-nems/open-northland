import type { HumanJobExperienceType } from '@open-northland/data';
import { Settler } from '../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { generalTrackFor, SCOUT_EXPERIENCE_TYPE } from './experience.js';

/**
 * ProgressionSystem (bonus-curve half): how much better an experienced settler is at its specialization.
 *
 * The curve maps completed-work REPEATS (not raw XP, see {@link experienceRepeats}) to a bonus fraction:
 *
 *   bonus(n) = n / (n + K * (1 - n/N)),  K = 4.9,  N = 100
 *
 * a diminishing-returns hyperbola whose K shrinks to zero as n approaches N, so 100% is actually
 * reachable at n = N (a plain n/(n+K) never gets there). K = 4.9 fits the reference bonus table
 * (1: 17%, 2: 29%, 3: 38% ... 11: 70%) within ~2 points; N = 100 is the chosen mastery point (design
 * rule, user-specified; an approximation, not an extracted original curve).
 *
 * What a bonus point buys (output per cycle, gather speed, damage) is the consuming system's concern;
 * this module only owns the shared curve.
 */

/** Repeats at which the bonus reaches exactly 100% (`N` in the curve), the mastery point. */
export const EXPERIENCE_MASTERY_REPEATS = 100;

/** The curve's `K` in thousandths (K = 4.9); millis keep the ratio integer-exact below. */
const CURVE_STEEPNESS_MILLI = 4900;

/**
 * The experience bonus for `repeats` completed works, in [0, ONE] (0% .. 100%). Clamps below 0 and at
 * {@link EXPERIENCE_MASTERY_REPEATS}; monotonically increasing between. Computed as the integer-exact
 * ratio 1000n / (1000n + K-milli * (N-n) / N), whole for every n since 4900/100 divides evenly, then
 * divided once in fixed point, so the same `repeats` always yields the same `Fixed`.
 */
export function experienceBonus(repeats: number): Fixed {
  const n = Math.trunc(repeats);
  if (n <= 0) return ZERO;
  if (n >= EXPERIENCE_MASTERY_REPEATS) return ONE;
  const numer = 1000 * n;
  const denom =
    numer + (CURVE_STEEPNESS_MILLI * (EXPERIENCE_MASTERY_REPEATS - n)) / EXPERIENCE_MASTERY_REPEATS;
  return fx.div(fx.fromInt(numer), fx.fromInt(denom));
}

/**
 * Completed-work repeats a settler's raw XP on `track` represents. Accrual adds the track's
 * `experienceFactor` per completed work, so dividing it back out recovers the repeat count the curve
 * is defined over ("baker 5" means five baked batches, regardless of the track's accrual rate).
 * Truncates partial credit (fight XP granted at a foreign track's rate); a rate-0 track represents no
 * repeats.
 */
export function experienceRepeats(xp: number, track: HumanJobExperienceType): number {
  return track.experienceFactor > 0 ? Math.trunc(xp / track.experienceFactor) : 0;
}

/**
 * A production operator's current bonus fraction — the curve read on its job-GENERAL track (the same
 * track production XP accrues into): "baker 5" bakes half a bread extra per cycle. ZERO for a gone or
 * jobless operator, a profession with no general track, or one with no repeats yet.
 */
export function operatorProductionBonus(world: World, ctx: SystemContext, operator: Entity): Fixed {
  const s = world.tryGet(operator, Settler);
  if (s === undefined || s.jobType === null) return ZERO;
  const track = generalTrackFor(ctx, s.jobType);
  if (track === undefined) return ZERO;
  return experienceBonus(experienceRepeats(s.experience.get(track.typeId) ?? 0, track));
}

/** Extra vision nodes a mastered scout sees — deliberately small next to the other trades' 2x
 *  (design rule, user-specified: a seasoned scout sees a bit farther, never twice as far). */
export const SCOUT_VISION_BONUS_MAX_NODES = 6;

/** The extra vision nodes a scout's signpost experience grants: the curve read on its
 *  {@link SCOUT_EXPERIENCE_TYPE} bucket (raw XP = erected posts), scaled to
 *  {@link SCOUT_VISION_BONUS_MAX_NODES} and truncated to whole nodes. */
export function scoutVisionBonusNodes(experience: ReadonlyMap<number, number>): number {
  const posts = experience.get(SCOUT_EXPERIENCE_TYPE) ?? 0;
  return fx.toInt(fx.mul(experienceBonus(posts), fx.fromInt(SCOUT_VISION_BONUS_MAX_NODES)));
}
