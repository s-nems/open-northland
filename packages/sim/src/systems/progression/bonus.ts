import type { HumanJobExperienceType } from '@open-northland/data';
import { Settler } from '../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';
import { fightExperienceTypeFor, generalTrackFor, SCOUT_EXPERIENCE_TYPE, trackFor } from './experience.js';

/**
 * ProgressionSystem (bonus-curve half): how much better an experienced settler is at its specialization.
 *
 * The curve maps completed-work REPEATS (not raw XP, see {@link experienceRepeats}) to a bonus fraction:
 *
 *   bonus(n) = n / (n + K * (1 - n/N)),  K = 4.9,  N = 100
 *
 * a diminishing-returns hyperbola whose K shrinks to zero as n approaches N, so 100% is actually
 * reachable at n = N (a plain n/(n+K) never gets there). K = 4.9 fits the reference bonus table
 * (1: 17%, 2: 29%, 3: 38% ... 11: 70%) within ~2 points; the table was MEASURED from the original
 * game by the user (observation, 2026-07-25 — not extracted data). N = 100 is the chosen mastery
 * point (design rule, user-specified).
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
 * Repeats a raw XP total represents on an OPTIONAL track — the one reading of the `needfor*` repeats
 * scale, shared by the sim gate (`experienceRequirementMet`), the panel's unlock forecast, and the
 * sandbox mastery seeding, so the three can't drift. A track-less expType (the fight/TRAINING/scout
 * buckets) accrues at rate 1, so its raw XP already is the repeat count.
 */
export function repeatsForExpType(track: HumanJobExperienceType | undefined, xp: number): number {
  return track === undefined ? xp : experienceRepeats(xp, track);
}

/** The raw XP worth `repeats` on an optional track — {@link repeatsForExpType}'s inverse, for seeding
 *  a veteran that must clear a repeats threshold (the sandbox gather-mastery stamp). */
export function rawXpForRepeats(track: HumanJobExperienceType | undefined, repeats: number): number {
  return repeats * (track?.experienceFactor ?? 1);
}

/**
 * A production operator's current bonus fraction — the curve read on its job-GENERAL track (the same
 * track production XP accrues into): "baker 5" bakes half a bread extra per cycle. ZERO for a gone or
 * jobless operator, a profession with no general track, or one with no repeats yet. A carrier operator
 * (a carrier-run utility like the well) is ZERO too: its delivery-earned XP is display-only and must
 * not leak into output, mirroring its exclusion from batch XP (design rule, user-specified).
 */
export function operatorProductionBonus(world: World, ctx: SystemContext, operator: Entity): Fixed {
  const s = world.tryGet(operator, Settler);
  if (s === undefined || s.jobType === null || isCarrierJob(ctx, s.jobType)) return ZERO;
  const track = generalTrackFor(ctx, s.jobType);
  if (track === undefined) return ZERO;
  return experienceBonus(experienceRepeats(s.experience.get(track.typeId) ?? 0, track));
}

/**
 * A worker's work-speed bonus on `goodType` — the curve read on its `(job, good)` track via
 * {@link trackFor}, the same track its extraction XP accrues into ("Zbieracz Drewna 10" chops faster).
 * ZERO for a gone or jobless worker or a pairing that trains no specialization.
 */
export function workSpeedBonus(world: World, ctx: SystemContext, worker: Entity, goodType: number): Fixed {
  const s = world.tryGet(worker, Settler);
  if (s === undefined || s.jobType === null) return ZERO;
  const track = trackFor(ctx, s.jobType, goodType);
  if (track === undefined) return ZERO;
  return experienceBonus(experienceRepeats(s.experience.get(track.typeId) ?? 0, track));
}

/**
 * A repeated-work count shrunk by a work-speed `bonus`: it scales as 1/(1 + bonus), so mastery
 * (bonus = ONE) halves it — the same work done in half the repetitions, each at its natural pace (up
 * to 2x work speed; design rule, user-specified: experience buys fewer swings, never faster
 * animations). Round-half-up on the exact integer ratio, never below one repetition.
 */
export function scaledWorkRepeats(repeats: number, bonus: Fixed): number {
  if (bonus <= ZERO) return repeats;
  const denom = ONE + bonus;
  return Math.max(1, Math.trunc((repeats * ONE + Math.trunc(denom / 2)) / denom));
}

/**
 * Hits at which a weapon class's damage bonus tops out. Combat XP lands per successful hit, far faster
 * than a craftsman's production batches, so combat mastery sits 5x deeper than the shared curve's
 * {@link EXPERIENCE_MASTERY_REPEATS} (balance judgment, approximation).
 */
export const FIGHT_MASTERY_HITS = 500;
const HITS_PER_FIGHT_REPEAT = FIGHT_MASTERY_HITS / EXPERIENCE_MASTERY_REPEATS;

/** The damage cap — a mastered weapon hits half again as hard, deliberately below the crafts' 2x
 *  (design rule, user-specified: combat scales gentler than the economy). */
export const FIGHT_DAMAGE_BONUS_MAX: Fixed = fx.div(ONE, fx.fromInt(2));

/**
 * The damage-bonus fraction `hits` landed with one weapon class buy, in [0, FIGHT_DAMAGE_BONUS_MAX].
 * Raw bucket XP is read as the hit count directly (the soldier-general accrual rate is 1 per hit in the
 * base data; a modded rate would scale leveling speed, approximation).
 */
export function fightDamageBonus(hits: number): Fixed {
  return fx.mul(experienceBonus(Math.trunc(hits / HITS_PER_FIGHT_REPEAT)), FIGHT_DAMAGE_BONUS_MAX);
}

/**
 * `base` weapon damage raised by the attacker's fight experience in `weaponMainType`'s bucket
 * ({@link fightExperienceTypeFor}) — the bonus fraction of the base, truncated to whole points (damage
 * stays an integer). Unchanged for an untrained bucket, a class with no fight track, or zero base.
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

/** Extra vision nodes a mastered scout sees — deliberately small next to the other trades' 2x
 *  (design rule, user-specified: a seasoned scout sees a bit farther, never twice as far). */
export const SCOUT_VISION_BONUS_MAX_NODES = 6;

/** The extra vision nodes `posts` erected signposts grant (the {@link SCOUT_EXPERIENCE_TYPE} bucket's
 *  raw XP): the curve scaled to {@link SCOUT_VISION_BONUS_MAX_NODES} and truncated to whole nodes.
 *  Takes the count, not the experience map, so the settler panel can state the real effect too. */
export function scoutVisionBonusNodes(posts: number): number {
  return fx.toInt(fx.mul(experienceBonus(posts), fx.fromInt(SCOUT_VISION_BONUS_MAX_NODES)));
}
