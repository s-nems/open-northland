import type { HumanJobExperienceType } from '@open-northland/data';
import { Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { WEAPON_MAIN_TYPE } from '../readviews/combat.js';

/**
 * ProgressionSystem (XP-accrual half) — a settler gets better at the specialization it works.
 *
 * In Cultures, experience is granted within a narrow `(job, good)` specialization (e.g. "collector wood" =
 * job 8 + good 5), not just per job — doing the same job on the same good repeatedly is what makes a settler
 * an expert at it (see `HumanJobExperienceType`, the `humanjobexperiencetypes` IR). This module owns the
 * lookup-and-grant so the AtomicSystem stays the executor: when a settler completes a work atomic that
 * yields a good (today: `harvest`), {@link grantWorkExperience} finds the matching track for
 * `(settler.jobType, goodType)` and adds its `experienceFactor` to the settler's per-specialization XP,
 * keyed by the track's `typeId`.
 *
 * A helper called from the executor, not a per-tick `System`: XP is event-shaped (it accrues the instant a
 * work atomic completes), and sim events are render-only (must not be read back in sim logic — see
 * events.ts), so the grant lives where the completion is known — AtomicSystem's effect-apply.
 *
 * The gating/tech-graph half ({@link buildingEnabled}, {@link goodEnabled}) is query-shaped instead: it
 * inspects current world state, so each lives here as a pure helper its consumer calls. The `needfor*`/
 * `allow*`/`trainforjob` schooling gates (the XP→level→unlock curve) are a later slice.
 *
 * XP is a whole-number counter on the original's integer scale (no fixed-point needed), resolved by a stable
 * `Array.find` over content and hashed in sorted-key order (snapshot.ts).
 */

/**
 * Find the `(job, good)` experience track a completed work atomic accrues into, or `undefined` when none
 * matches (not every activity trains a specialization).
 *
 * A track names its owning `jobType` (always) and, when good-specific, the `goodType` it trains on. A
 * good-specific track must match both ids; a general track (no `goodType`) matches the job regardless of
 * good. The good-specific match is preferred over a general one for the same job, so a job with both a
 * wood-specific and a general track accrues the wood one when chopping wood.
 */
export function trackFor(
  ctx: SystemContext,
  jobType: number,
  goodType: number,
): HumanJobExperienceType | undefined {
  let general: HumanJobExperienceType | undefined;
  for (const t of ctx.content.jobExperience) {
    if (t.jobType !== jobType) continue;
    if (t.goodType === goodType) return t; // most-specific: the (job, good) track
    if (t.goodType === undefined && general === undefined) general = t; // first general fallback
  }
  return general;
}

/**
 * Grant a settler XP for completing a work atomic that yielded `goodType`. No-ops when the settler has no
 * job, is gone, or no track matches the `(job, good)` pairing. Adds the track's `experienceFactor` to the
 * settler's running XP for that specialization, keyed by the track's `typeId`. `experienceFactor` is the
 * original's per-track accrual rate (raw integer, 1..250 in the base data); summing it per completed work
 * is the basic "repetition builds expertise" accrual — the non-linear XP→level curve (`baseRepeatCounter`)
 * is a later balance slice (source basis).
 */
export function grantWorkExperience(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  goodType: number,
): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined || s.jobType === null) return; // gone, or no job to train a specialization
  const track = trackFor(ctx, s.jobType, goodType);
  if (track === undefined) return; // this (job, good) pairing trains no specialization
  accrueExperience(s, track.typeId, track.experienceFactor);
}

/** Accrue `amount` XP into a settler's `trackId` specialization bucket — the shared tail of the
 *  work- and fight-XP grants (and the single seam a future accrual cap/curve would land in). */
function accrueExperience(s: { experience: Map<number, number> }, trackId: number, amount: number): void {
  s.experience.set(trackId, (s.experience.get(trackId) ?? 0) + amount);
}

/**
 * The fight experience-type ids (`logicdefines.inc` `JOB_EXPERIENCE_TYPE_FIGHT_*`, l.598-603) — the
 * per-weapon-class buckets combat XP accrues into on `Settler.experience`, the same expType id space the
 * `needfor*` soldier-upgrade gates read: the viking `needforjob` for the iron-spear soldier requires expType
 * `SPEAR` (72), the long-sword soldier `SWORD` (73), the long-bow soldier `BOW` (75) — so accruing fight XP
 * here locks the better soldier classes behind fight experience through the existing
 * {@link settlerMeetsNeed} gate. These ids back no `HumanJobExperienceType` record (no `experienceFactor` of
 * their own); the accrual rate comes from the `soldier general` track
 * ({@link SOLDIER_GENERAL_EXPERIENCE_TYPE}). Pinned to `logicdefines.inc`.
 */
export const FIGHT_EXPERIENCE_TYPE = {
  FIST: 71,
  SPEAR: 72,
  SWORD: 73,
  AXE: 74,
  BOW: 75,
  CATAPULT: 76,
} as const;

/** The `humanjobexperiencetypes` track whose `experienceFactor` sets the per-swing fight-XP rate — the
 *  `soldier general` track (`type 69`, factor 1 in the base data). The fight buckets
 *  ({@link FIGHT_EXPERIENCE_TYPE}) have no record of their own, so a fight swing accrues this track's factor
 *  into the weapon's bucket. */
const SOLDIER_GENERAL_EXPERIENCE_TYPE = 69;

/**
 * The fight-XP bucket a weapon of coarse class `weaponMainType` ({@link WEAPON_MAIN_TYPE}) accrues into —
 * its {@link FIGHT_EXPERIENCE_TYPE} (unarmed→FIST, spear→SPEAR, sword→SWORD, axe→AXE, bow→BOW,
 * catapult→CATAPULT). Saber has no fight track in the data (no `JOB_EXPERIENCE_TYPE_FIGHT_SABER`), so a
 * saber swing maps to `undefined` — it accrues no fight XP (approximated, source basis).
 */
const FIGHT_EXPERIENCE_TYPE_BY_WEAPON_MAIN_TYPE: ReadonlyMap<number, number> = new Map([
  [WEAPON_MAIN_TYPE.UNARMED, FIGHT_EXPERIENCE_TYPE.FIST],
  [WEAPON_MAIN_TYPE.SPEAR, FIGHT_EXPERIENCE_TYPE.SPEAR],
  [WEAPON_MAIN_TYPE.SWORD, FIGHT_EXPERIENCE_TYPE.SWORD],
  [WEAPON_MAIN_TYPE.AXE, FIGHT_EXPERIENCE_TYPE.AXE],
  [WEAPON_MAIN_TYPE.BOW, FIGHT_EXPERIENCE_TYPE.BOW],
  [WEAPON_MAIN_TYPE.CATAPULT, FIGHT_EXPERIENCE_TYPE.CATAPULT],
]);

/**
 * The fight-experience bucket a `weaponMainType` accrues into, or `undefined` when the weapon has no fight
 * track (saber, or a `mainType` outside {@link WEAPON_MAIN_TYPE}). A pure lookup over the constant
 * {@link FIGHT_EXPERIENCE_TYPE_BY_WEAPON_MAIN_TYPE} map.
 */
function fightExperienceTypeFor(weaponMainType: number): number | undefined {
  return FIGHT_EXPERIENCE_TYPE_BY_WEAPON_MAIN_TYPE.get(weaponMainType);
}

/**
 * Grant an attacker fight XP for a damaging swing — accrue the {@link SOLDIER_GENERAL_EXPERIENCE_TYPE}
 * track's `experienceFactor` (1/swing in the base data) into the bucket for the swinging weapon's class
 * ({@link fightExperienceTypeFor}). The combat sibling of {@link grantWorkExperience}: where work XP trains
 * a `(job, good)` specialization, a fight swing trains the weapon class, so better soldier classes unlock
 * through the same accrued-XP gate.
 *
 * No-ops when: the weapon has no `mainType` (an unarmed/mainType-less combatant), the weapon class has no
 * fight track (saber), the attacker is gone, or content carries no `soldier general` track (rate 0).
 *
 * Approximated: the accrual trigger (per-damaging-swing) has no readable oracle — the original may accrue
 * per swing or per kill; per-damaging-swing is the deterministic reading. The XP→level→stat curve
 * (`baseRepeatCounter`, the combat bonuses a level grants) is a later calibration slice (source basis).
 */
export function grantFightExperience(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  weaponMainType: number | undefined,
): void {
  if (weaponMainType === undefined) return; // an unarmed / mainType-less weapon trains no fight class
  const bucket = fightExperienceTypeFor(weaponMainType);
  if (bucket === undefined) return; // a weapon class with no fight track (saber)
  const rate = fightExperienceRate(ctx);
  if (rate <= 0) return; // no `soldier general` track in content — nothing to accrue
  const s = world.tryGet(attacker, Settler);
  if (s === undefined) return; // attacker gone
  accrueExperience(s, bucket, rate);
}

/** The per-swing fight-XP rate — the {@link SOLDIER_GENERAL_EXPERIENCE_TYPE} track's `experienceFactor`
 *  (1 in the base data), or `0` when content carries no such track. A pure content read. */
function fightExperienceRate(ctx: SystemContext): number {
  const track = contentIndex(ctx.content).jobExperience.get(SOLDIER_GENERAL_EXPERIENCE_TYPE);
  return track?.experienceFactor ?? 0;
}
