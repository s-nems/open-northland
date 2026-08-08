import type { HumanJobExperienceType } from '@open-northland/data';
import { Settler } from '../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';
import { fightExperienceTypeFor, generalTrackFor, SCOUT_EXPERIENCE_TYPE, trackFor } from './experience.js';

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

/**
 * The repeats a settler's XP contributes toward one `needfor*` requirement, summed over its `expTypes`,
 * each track counted at most once. A track-less expType accrues at rate 1, so its raw XP is already the
 * repeat count; a good-specific track counts its own repeats; a job-general track counts every track its
 * job owns, because work accrues only the matched track while gates key on the trade's overall practice.
 * Approximated: the original's threshold arithmetic is not readable.
 */
export function requirementRepeats(
  tracks: readonly HumanJobExperienceType[],
  experience: ReadonlyMap<number, number>,
  expTypes: readonly number[],
): number {
  const { byId, byJob } = trackTables(tracks);
  let repeats = 0;
  const counted = new Set<number>();
  const count = (track: HumanJobExperienceType): void => {
    if (counted.has(track.typeId)) return;
    counted.add(track.typeId);
    repeats += experienceRepeats(experience.get(track.typeId) ?? 0, track);
  };
  for (const expType of expTypes) {
    const named = byId.get(expType);
    if (named === undefined) repeats += experience.get(expType) ?? 0;
    else if (named.goodType !== undefined) count(named);
    else for (const t of byJob.get(named.jobType) ?? []) count(t);
  }
  return repeats;
}

/** The by-id and by-owning-job track lookups, memoized per content array so the per-tick gate never
 *  rescans the catalog. First-wins per id. */
const TRACK_TABLES = new WeakMap<
  readonly HumanJobExperienceType[],
  {
    byId: ReadonlyMap<number, HumanJobExperienceType>;
    byJob: ReadonlyMap<number, readonly HumanJobExperienceType[]>;
  }
>();

function trackTables(tracks: readonly HumanJobExperienceType[]) {
  const cached = TRACK_TABLES.get(tracks);
  if (cached !== undefined) return cached;
  const byId = new Map<number, HumanJobExperienceType>();
  const byJob = new Map<number, HumanJobExperienceType[]>();
  for (const t of tracks) {
    if (!byId.has(t.typeId)) byId.set(t.typeId, t);
    const owned = byJob.get(t.jobType);
    if (owned === undefined) byJob.set(t.jobType, [t]);
    else owned.push(t);
  }
  const tables = { byId, byJob };
  TRACK_TABLES.set(tracks, tables);
  return tables;
}

/** The raw XP worth `repeats` on an optional track - {@link experienceRepeats}' inverse. */
export function rawXpForRepeats(track: HumanJobExperienceType | undefined, repeats: number): number {
  return repeats * (track?.experienceFactor ?? 1);
}

/**
 * A production operator's current bonus fraction, read on the job-general track production XP accrues
 * into. ZERO for a gone or jobless operator, a profession with no general track, or a carrier operator:
 * authored, a carrier's delivery-earned XP is display-only and must not leak into output.
 */
export function operatorProductionBonus(world: World, ctx: SystemContext, operator: Entity): Fixed {
  const s = world.tryGet(operator, Settler);
  if (s === undefined || s.jobType === null || isCarrierJob(ctx, s.jobType)) return ZERO;
  const track = generalTrackFor(ctx, s.jobType);
  if (track === undefined) return ZERO;
  return experienceBonus(experienceRepeats(s.experience.get(track.typeId) ?? 0, track));
}

/**
 * A worker's work-speed bonus on `goodType`, read on the `(job, good)` track its extraction XP accrues
 * into. ZERO for a gone or jobless worker, or a pairing that trains no specialization.
 */
export function workSpeedBonus(world: World, ctx: SystemContext, worker: Entity, goodType: number): Fixed {
  const s = world.tryGet(worker, Settler);
  if (s === undefined || s.jobType === null) return ZERO;
  const track = trackFor(ctx, s.jobType, goodType);
  if (track === undefined) return ZERO;
  return experienceBonus(experienceRepeats(s.experience.get(track.typeId) ?? 0, track));
}

/**
 * A repeated-work count shrunk by a work-speed `bonus`, scaling as 1/(1 + bonus), so mastery halves it.
 * Authored: experience buys fewer swings, never faster animations. Round-half-up on the exact integer
 * ratio, never below one repetition.
 */
export function scaledWorkRepeats(repeats: number, bonus: Fixed): number {
  if (bonus <= ZERO) return repeats;
  const denom = ONE + bonus;
  return Math.max(1, Math.trunc((repeats * ONE + Math.trunc(denom / 2)) / denom));
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
