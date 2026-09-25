import type { HumanJobExperienceType } from '@open-northland/data';
import { Settler, SettlerProgress } from '../../components/index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';
import { fightExperienceTypeFor, generalTrackFor, SCOUT_EXPERIENCE_TYPE, trackFor } from './experience.js';

/**
 * The original's experience curve. A track accrues its `experienceFactor` per completed work and the curve
 * reads that total in hundredths ("points"), so the factor is the track's learning rate: a factor-100
 * trade climbs one point per work, wood collection (250) two and a half, the builder (5) one per twenty.
 *
 *   pct(points) = trunc((10000 - 100 * trunc(10000 / (20 * points + 100))) / 98), clamped to [0, 100]
 *
 * a diminishing-returns hyperbola in integer arithmetic: 17/29/38/45/51 percent at points 1..5, 68 at
 * 10, 97 at 100, and 100 from 162 on. Original behavior, matching a bonus table observed on the running
 * original at points 1..11.
 */

/** Raw XP per curve point. */
export const EXPERIENCE_XP_PER_POINT = 100;

/** Curve points raw XP `xp` on any track stands at; partial credit truncates. */
export function experiencePoints(xp: number): number {
  return xp > 0 ? Math.trunc(xp / EXPERIENCE_XP_PER_POINT) : 0;
}

/** The points at which {@link experiencePercent} first reaches 100. */
export const EXPERIENCE_MASTERY_POINTS = 162;

const PERCENT = 100;
/** The curve's fixed-point scale: percent in hundredths. */
const CURVE_SCALE = 10_000;
/** Hundredths one point adds to the hyperbola's denominator. */
const CURVE_POINT_WEIGHT = 20;
/** The denominator's offset, so zero points reads as zero percent. */
const CURVE_OFFSET = 100;
/** The spread the hundredths are divided over, which is what lets the curve reach 100 rather than only
 *  approach it. */
const CURVE_SPREAD = 98;

/** The experience percent at `points`, in [0, 100], monotonically increasing to the plateau. */
export function experiencePercent(points: number): number {
  const p = Math.trunc(points);
  if (p <= 0) return 0;
  const inverse = Math.trunc(CURVE_SCALE / (CURVE_POINT_WEIGHT * p + CURVE_OFFSET));
  const pct = Math.trunc((CURVE_SCALE - CURVE_OFFSET * inverse) / CURVE_SPREAD);
  return Math.min(PERCENT, Math.max(0, pct));
}

/** The experience percent at `points` as a fraction in [0, ONE]. */
export function experienceBonus(points: number): Fixed {
  const pct = experiencePercent(points);
  if (pct >= PERCENT) return ONE;
  return fx.div(fx.fromInt(pct), fx.fromInt(PERCENT));
}

/**
 * Completed-work repeats a settler's raw XP on `track` represents: accrual adds `experienceFactor` per
 * completed work, so dividing it back out recovers the count the `needfor*` requirement gates and the
 * experience rows are stated in. Partial credit truncates, and a rate-0 track represents no repeats.
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

/**
 * A worker's experience percent for working `goodType`, read on the `(job, good)` track its work accrues
 * into: the product's specialization when content carries one, the profession-general track otherwise
 * and for a good-less work (`null`, the builder's). 0 for a gone or jobless worker, a pairing with no
 * track, or a carrier: a carrier's delivery-earned XP is display-only and must not speed any work.
 */
export function jobExperiencePercent(
  world: World,
  ctx: SystemContext,
  worker: Entity,
  goodType: number | null,
): number {
  const s = world.tryGet(worker, Settler);
  if (s === undefined || s.jobType === null || isCarrierJob(ctx, s.jobType)) return 0;
  const track = goodType === null ? generalTrackFor(ctx, s.jobType) : trackFor(ctx, s.jobType, goodType);
  if (track === undefined) return 0;
  const xp = world.get(worker, SettlerProgress).experience.get(track.typeId) ?? 0;
  return experiencePercent(experiencePoints(xp));
}

/**
 * Hits at which a weapon class's damage bonus tops out. Authored: combat XP lands per successful hit, far
 * faster than production batches, so combat mastery sits 5x deeper than {@link EXPERIENCE_MASTERY_POINTS}.
 */
const HITS_PER_FIGHT_POINT = 5;
export const FIGHT_MASTERY_HITS = EXPERIENCE_MASTERY_POINTS * HITS_PER_FIGHT_POINT;

/** The damage cap: a mastered weapon hits half again as hard, deliberately below the crafts' 2.5x.
 *  Authored, so combat scales gentler than the economy. */
export const FIGHT_DAMAGE_BONUS_MAX: Fixed = fx.div(ONE, fx.fromInt(2));

/**
 * The damage-bonus fraction `hits` landed with one weapon class buy, in [0, FIGHT_DAMAGE_BONUS_MAX]. Raw
 * bucket XP is read as the hit count directly, since the soldier-general accrual rate is 1 per hit in the
 * base data; a modded rate would scale leveling speed (approximation).
 */
export function fightDamageBonus(hits: number): Fixed {
  return fx.mul(experienceBonus(Math.trunc(hits / HITS_PER_FIGHT_POINT)), FIGHT_DAMAGE_BONUS_MAX);
}

/** Landed hits recorded in `weaponMainType`'s fight bucket: 0 for a class with no bucket. */
export function weaponClassHits(
  experience: ReadonlyMap<number, number>,
  weaponMainType: number | null | undefined,
): number {
  if (weaponMainType == null) return 0;
  const bucket = fightExperienceTypeFor(weaponMainType);
  return bucket === undefined ? 0 : (experience.get(bucket) ?? 0);
}

/**
 * `base` weapon damage raised by `hits` landed with the swinging weapon's class, truncated to whole points.
 * Unchanged for an untrained class or zero base.
 */
export function withFightDamageBonus(base: number, hits: number): number {
  if (base <= 0 || hits <= 0) return base;
  return base + fx.toInt(fx.mul(fx.fromInt(base), fightDamageBonus(hits)));
}

/** The hits past which fight experience stops raising damage against a building. Original behavior. */
export const HOUSE_DAMAGE_EXPERIENCE_CAP_HITS = 100;
/** The numerator of the building-damage experience factor `NUMERATOR / (NUMERATOR - hits)`. */
const HOUSE_DAMAGE_EXPERIENCE_NUMERATOR = 200;

/**
 * `base` vs-building damage raised by `hits` landed with the swinging weapon's class:
 * `base * 200 / (200 - min(hits, 100))`, so a hundred landed hits double it. Original behavior, which reads
 * the building case apart from the bonus a blow on a person gets ({@link withFightDamageBonus}).
 */
export function withHouseDamageExperience(base: number, hits: number): number {
  if (base <= 0) return base;
  const capped = Math.min(Math.max(hits, 0), HOUSE_DAMAGE_EXPERIENCE_CAP_HITS);
  return Math.trunc(
    (base * HOUSE_DAMAGE_EXPERIENCE_NUMERATOR) / (HOUSE_DAMAGE_EXPERIENCE_NUMERATOR - capped),
  );
}

/** Extra vision nodes a mastered scout sees, deliberately small next to the other trades' gains. Authored:
 *  a seasoned scout sees a bit farther, never twice as far. */
export const SCOUT_VISION_BONUS_MAX_NODES = 6;

/** The extra vision nodes `posts` erected signposts grant (the {@link SCOUT_EXPERIENCE_TYPE} bucket's raw
 *  XP, read as curve points): the curve scaled to {@link SCOUT_VISION_BONUS_MAX_NODES}, truncated to
 *  whole nodes. */
export function scoutVisionBonusNodes(posts: number): number {
  return fx.toInt(fx.mul(experienceBonus(posts), fx.fromInt(SCOUT_VISION_BONUS_MAX_NODES)));
}
