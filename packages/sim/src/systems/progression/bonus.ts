import type { HumanJobExperienceType } from '@open-northland/data';
import { Settler, SettlerProgress } from '../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';
import { fightExperienceTypeFor, SCOUT_EXPERIENCE_TYPE, trackFor } from './experience.js';

/**
 * The shared experience curve, mapping completed-work repeats rather than raw XP to a bonus fraction:
 *
 *   bonus(n) = n / (n + K * (1 - n/N)),  K = 4.9,  N = 100
 *
 * a diminishing-returns hyperbola whose K shrinks to zero as n approaches N, so 100% is reachable at
 * n = N. Observation: K = 4.9 fits a bonus table measured on the running original (1: 17%, 2: 29%,
 * 3: 38% ... 11: 70%) within ~2 points. Authored: N = 100 is the chosen mastery point.
 */

/** `N` in the curve: the repeats at which the bonus reaches exactly 100%. */
export const EXPERIENCE_MASTERY_REPEATS = 100;

/** The curve's `K` in thousandths (K = 4.9); millis keep the ratio integer-exact below. */
const CURVE_STEEPNESS_MILLI = 4900;

/**
 * The experience bonus for `repeats` completed works, in [0, ONE], monotonically increasing between the
 * clamps. Computed as the integer-exact ratio 1000n / (1000n + K-milli * (N-n) / N), whole for every n
 * since 4900/100 divides evenly, then divided once in fixed point.
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
 * Completed-work repeats a settler's raw XP on `track` represents: accrual adds `experienceFactor` per
 * completed work, so dividing it back out recovers the repeat count the curve is defined over. Partial
 * credit truncates, and a rate-0 track represents no repeats.
 */
export function experienceRepeats(xp: number, track: HumanJobExperienceType): number {
  return track.experienceFactor > 0 ? Math.trunc(xp / track.experienceFactor) : 0;
}

/** Requirements sum only the named tracks; XP retains the saved factor-scaled encoding. */
export function requirementRepeats(
  tracks: readonly HumanJobExperienceType[],
  experience: ReadonlyMap<number, number>,
  expTypes: readonly number[],
): number {
  let repeats = 0;
  for (const id of expTypes) {
    const track = tracks.find((t) => t.typeId === id);
    const xp = experience.get(id) ?? 0;
    repeats += track === undefined ? xp : experienceRepeats(xp, track);
  }
  return repeats;
}

/** The raw XP worth `repeats` on an optional track - {@link experienceRepeats}' inverse. */
export function rawXpForRepeats(track: HumanJobExperienceType | undefined, repeats: number): number {
  return repeats * (track?.experienceFactor ?? 1);
}

/** The curve read on the `(job, good)` track a settler's work accrues into - the product's
 *  specialization when content carries one, the profession-general track otherwise. */
function trackBonus(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  goodType: number,
): Fixed {
  const track = trackFor(ctx, jobType, goodType);
  if (track === undefined) return ZERO;
  const points = world.get(settler, SettlerProgress).experience.get(track.typeId) ?? 0;
  return experienceBonus(experienceRepeats(points, track));
}

/**
 * A production operator's current bonus fraction for `goodType`. ZERO for a gone or jobless operator, a
 * pairing with no track, or a carrier operator: a carrier's delivery-earned XP is display-only and must
 * not leak into output.
 */
export function operatorProductionBonus(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  goodType: number,
): Fixed {
  const s = world.tryGet(operator, Settler);
  if (s === undefined || s.jobType === null || isCarrierJob(ctx, s.jobType)) return ZERO;
  return trackBonus(world, ctx, operator, s.jobType, goodType);
}

/** A worker's work-speed bonus on `goodType`, off the same track {@link operatorProductionBonus} reads.
 *  ZERO for a gone or jobless worker, or a pairing that trains nothing. */
export function workSpeedBonus(world: World, ctx: SystemContext, worker: Entity, goodType: number): Fixed {
  const jobType = world.tryGet(worker, Settler)?.jobType;
  return jobType === undefined || jobType === null ? ZERO : trackBonus(world, ctx, worker, jobType, goodType);
}

/**
 * Hits at which a weapon class's damage bonus tops out. Authored: combat XP lands per successful hit, far
 * faster than production batches, so combat mastery sits 5x deeper than
 * {@link EXPERIENCE_MASTERY_REPEATS}.
 */
export const FIGHT_MASTERY_HITS = 500;
const HITS_PER_FIGHT_REPEAT = FIGHT_MASTERY_HITS / EXPERIENCE_MASTERY_REPEATS;

/** The damage cap: a mastered weapon hits half again as hard, deliberately below the crafts' 2x.
 *  Authored, so combat scales gentler than the economy. */
export const FIGHT_DAMAGE_BONUS_MAX: Fixed = fx.div(ONE, fx.fromInt(2));

/**
 * The damage-bonus fraction `hits` landed with one weapon class buy, in [0, FIGHT_DAMAGE_BONUS_MAX]. Raw
 * bucket XP is read as the hit count directly, since the soldier-general accrual rate is 1 per hit in the
 * base data; a modded rate would scale leveling speed (approximation).
 */
export function fightDamageBonus(hits: number): Fixed {
  return fx.mul(experienceBonus(Math.trunc(hits / HITS_PER_FIGHT_REPEAT)), FIGHT_DAMAGE_BONUS_MAX);
}

/**
 * `base` weapon damage raised by the attacker's fight experience in `weaponMainType`'s bucket, truncated
 * to whole points. Unchanged for an untrained bucket, a class with no fight track, or zero base.
 */
export function withFightDamageBonus(
  base: number,
  experience: ReadonlyMap<number, number>,
  weaponMainType: number | undefined,
): number {
  if (base <= 0 || weaponMainType === undefined) return base;
  const bucket = fightExperienceTypeFor(weaponMainType);
  if (bucket === undefined) return base;
  const hits = experience.get(bucket) ?? 0;
  if (hits <= 0) return base;
  return base + fx.toInt(fx.mul(fx.fromInt(base), fightDamageBonus(hits)));
}

/** Extra vision nodes a mastered scout sees, deliberately small next to the other trades' 2x. Authored:
 *  a seasoned scout sees a bit farther, never twice as far. */
export const SCOUT_VISION_BONUS_MAX_NODES = 6;

/** The extra vision nodes `posts` erected signposts grant (the {@link SCOUT_EXPERIENCE_TYPE} bucket's raw
 *  XP): the curve scaled to {@link SCOUT_VISION_BONUS_MAX_NODES}, truncated to whole nodes. */
export function scoutVisionBonusNodes(posts: number): number {
  return fx.toInt(fx.mul(experienceBonus(posts), fx.fromInt(SCOUT_VISION_BONUS_MAX_NODES)));
}
