import type { ContentSet, HumanJobExperienceType } from '@open-northland/data';
import { Settler, type SettlerIdentity } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import {
  ATOMIC_EVENT_TYPE_TRAINING_EXPERIENCE,
  atomicEventChannelDelta,
  needAtomicAnimationName,
} from '../readviews/animations.js';
import { WEAPON_MAIN_TYPE } from '../readviews/combat.js';
import { isAnimalTribe, isHeroJob, isScoutJob, isSoldierJob } from '../readviews/index.js';
import { isCarrierJob, type WorkplaceOperators } from '../stores/index.js';

/**
 * ProgressionSystem (XP-accrual half) - a settler gets better at the specialization it works.
 *
 * In Cultures, experience is granted within a narrow `(job, good)` specialization (e.g. "collector wood" =
 * job 8 + good 5), not just per job - doing the same job on the same good repeatedly is what makes a settler
 * an expert at it (see `HumanJobExperienceType`, the `humanjobexperiencetypes` IR). This module owns the
 * lookup-and-grant so the AtomicSystem stays the executor: when a settler's completed work atomic
 * extracts units of a good (today: `harvest`), {@link grantWorkExperience} finds the matching track for
 * `(settler.jobType, goodType)` and adds its `experienceFactor` per unit to the settler's
 * per-specialization XP, keyed by the track's `typeId`.
 *
 * A helper called from the executor, not a per-tick `System`: XP is event-shaped (it accrues the instant a
 * work atomic completes), and sim events are render-only (must not be read back in sim logic - see
 * events.ts), so the grant lives where the completion is known - AtomicSystem's effect-apply.
 *
 * The gating/tech-graph half ({@link buildingEnabled}, {@link goodEnabled}) is query-shaped instead: it
 * inspects current world state, so each lives here as a pure helper its consumer calls (`./unlocks.ts`).
 * The `allow*` gates and the school's civilian-trade half of `trainfor*` are a later slice.
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
 * Strokes one unit of output costs this `(job, good)` pairing - the track's extracted
 * `baserepeatcounter` (`humanjobexperiencetypes.ini`: hunter 5, farmer wheat 2, fisher 5), read as
 * strokes-per-action. The reading is indirect but calibrated: the farm's measured throughput (~10
 * grain per farmer per 10 min, `catalog/farming.ts`) lands with 2 strokes and would not with 1 or 4;
 * per-stroke counting in the running original is unverified. 1 for a trackless pairing, a track
 * without the field, or an authored 0 - never below one stroke.
 */
export function workRepeatsFor(ctx: SystemContext, jobType: number | null, goodType: number): number {
  if (jobType === null) return 1;
  return Math.max(1, trackFor(ctx, jobType, goodType)?.baseRepeatCounter ?? 1);
}

/**
 * Grant a settler XP for `units` of `goodType` its completed work atomic actually extracted. No-ops when
 * the settler has no job, is gone, no track matches the `(job, good)` pairing, or the swing extracted
 * nothing (a mid-job chop/strike). Adds each track's `experienceFactor` per unit - XP counts resource
 * units gathered, never swings, so a felled trunk trains its whole yield at once (design rule,
 * user-specified). `experienceFactor` is the original's per-track accrual rate (raw integer, 1..250 in
 * the base data); the track's `baseRepeatCounter` is the stroke count ({@link workRepeatsFor}), not XP.
 *
 * Work trains ONLY the matched track - one XP row per worked resource, so digging stone never
 * advances the clay specialization (design rule, user-specified, 2026-07-25). The `needfor*` gates
 * keyed to a job-GENERAL track (the miller gate reads farmer-general) stay reachable because
 * {@link requirementRepeats} counts a general expType as the job's total repeats across all its
 * tracks; the general track itself accrues only where it is the direct target (production batches,
 * carrier deliveries, or the {@link trackFor} fallback for a good with no specific track).
 */
export function grantWorkExperience(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  goodType: number,
  units: number,
): void {
  if (units <= 0) return; // the swing extracted nothing - nothing to train on
  const s = world.tryGet(settler, Settler);
  if (s === undefined || s.jobType === null) return; // gone, or no job to train a specialization
  const track = trackFor(ctx, s.jobType, goodType);
  if (track === undefined) return; // this (job, good) pairing trains no specialization
  accrueExperience(s, track.typeId, track.experienceFactor * units);
}

/** Accrue `amount` XP into a settler's `trackId` specialization bucket - the shared tail of the
 *  work- and fight-XP grants (and the single seam a future accrual cap/curve would land in). */
function accrueExperience(s: { experience: Map<number, number> }, trackId: number, amount: number): void {
  if (amount <= 0) return; // a zero-rate track plants no zero-value bucket (a hash-visible key with no meaning)
  s.experience.set(trackId, (s.experience.get(trackId) ?? 0) + amount);
}

/** A job's general (no-good) experience track, or `undefined` when the job trains none; unlike
 *  {@link trackFor} it never resolves a good-specific track. The profession-wide grants below and the
 *  production-bonus read (`operatorProductionBonus`) key on it. */
export function generalTrackFor(ctx: SystemContext, jobType: number): HumanJobExperienceType | undefined {
  return ctx.content.jobExperience.find((t) => t.jobType === jobType && t.goodType === undefined);
}

/**
 * Grant production XP for a workplace's completed batches: one batch trains one present operator
 * (canonical order, never more than on station, cf. the military-piety charge in piety.ts) on its
 * job-GENERAL track. The good-specific production tracks are deliberately bypassed (a trade trains its
 * profession, whatever it crafted) and carrier operators are excluded (a carrier-run utility like the
 * well trains only on deliveries); both design rules, user-specified. Per-completed-batch is the
 * deterministic reading of the original's undecoded accrual trigger (approximation).
 */
export function grantProductionExperience(
  world: World,
  ctx: SystemContext,
  batches: number,
  operators: WorkplaceOperators,
): void {
  if (operators.kind === 'unstaffed') return;
  for (const op of operators.operators.slice(0, batches)) {
    const s = world.tryGet(op, Settler);
    if (s === undefined || s.jobType === null) continue; // operator gone or jobless, trains nothing
    if (isCarrierJob(ctx, s.jobType)) continue; // transport trains on deliveries, never on batches
    const track = generalTrackFor(ctx, s.jobType);
    if (track === undefined) continue; // profession with no general track, nothing to accrue
    accrueExperience(s, track.typeId, track.experienceFactor);
  }
}

/**
 * Grant a settler carry XP for one delivery that landed in a store, accruing the `carrier general`
 * track's `experienceFactor`. Carriers only ({@link isCarrierJob}): everyone hauls sometimes, but only
 * the transport trade trains on it, and a blocked deposit or flag drop trains nothing (design rule,
 * user-specified). Per-landed-delivery is the same deterministic reading of the original's undecoded
 * trigger as the batch grant above.
 */
export function grantCarryExperience(world: World, ctx: SystemContext, settler: Entity): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined || s.jobType === null || !isCarrierJob(ctx, s.jobType)) return;
  const track = generalTrackFor(ctx, s.jobType);
  if (track === undefined) return; // no `carrier general` track in content, nothing to accrue
  accrueExperience(s, track.typeId, track.experienceFactor);
}

/**
 * The scout's signpost-craft bucket - our extension: the original gives the scout NO experience track
 * at all, but here every erected signpost trains it (design rule, user-specified). Rate 1 per post, so
 * raw XP is the repeat count, like the fight buckets. The id sits outside the original's experience-type
 * space (`logicdefines.inc` `JOB_EXPERIENCE_TYPE_MAXIMUM` is 78), so no extracted track can collide.
 */
export const SCOUT_EXPERIENCE_TYPE = 100;

/** Grant a scout one signpost-craft XP for a guidepost it actually erected (the caller checks the post
 *  stood - a whiffed swing trains nothing). Only the scout trade trains it. */
export function grantScoutExperience(world: World, content: ContentSet, settler: Entity): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined || !isScoutJob(content, s.jobType)) return;
  accrueExperience(s, SCOUT_EXPERIENCE_TYPE, 1);
}

/**
 * The TRAINING bucket every `trainfor*` requirement row reads - the schooling XP a barracks drill banks
 * (source basis: each tribe's `trainforjob`/`trainforgood` rows name expType 77 and nothing else does).
 * Like the fight buckets it backs no `HumanJobExperienceType` record, so it accrues at rate 1 and its raw
 * XP already is the repeat count a row's `amount` is compared against.
 *
 * It accrues permanently here. The original flushes it whenever the trained job or good changes (which
 * covers retraining onto another soldier class, not only the school's civilian trades); that only starts
 * to matter once a second training target exists - see docs/tickets/features/barracks-training.md.
 */
export const TRAINING_EXPERIENCE_TYPE = 77;

/**
 * The TRAINING one finished repetition of `atomicId` banks for this settler: the clip its tribe binds and
 * its own {@link ATOMIC_EVENT_TYPE_TRAINING_EXPERIENCE} event total. Today that is always the civilist
 * exercise clip's `+1` - the soldier's own `train` clip, worth `+25`, is a later slice. Zero for content
 * that binds no such clip or a clip carrying no such event, which is what "this tribe schools nobody"
 * looks like from here - the AI's garrison hire reads it so it never drafts a man its data cannot school.
 */
export function drillTrainingGain(content: ContentSet, settler: SettlerIdentity, atomicId: number): number {
  const clip = needAtomicAnimationName(content, settler, atomicId);
  if (clip === undefined) return 0;
  return Math.max(0, atomicEventChannelDelta(content, clip, ATOMIC_EVENT_TYPE_TRAINING_EXPERIENCE));
}

/** Grant a settler the schooling XP its finished drill repetition is worth ({@link drillTrainingGain});
 *  a settler gone mid-drill banks nothing. */
export function grantTrainingExperience(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomicId: number,
): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined) return;
  const xp = drillTrainingGain(ctx.content, s, atomicId);
  if (xp > 0) accrueExperience(s, TRAINING_EXPERIENCE_TYPE, xp);
}

/**
 * The fight experience-type ids (`logicdefines.inc` `JOB_EXPERIENCE_TYPE_FIGHT_*`, l.598-603) - the
 * per-weapon-class buckets combat XP accrues into on `Settler.experience`, the same expType id space the
 * `needfor*` soldier-upgrade gates read: the viking `needforjob` for the iron-spear soldier requires expType
 * `SPEAR` (72), the long-sword soldier `SWORD` (73), the long-bow soldier `BOW` (75) - so accruing fight XP
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

/** The `humanjobexperiencetypes` track whose `experienceFactor` sets the per-swing fight-XP rate - the
 *  `soldier general` track (`type 69`, factor 1 in the base data). The fight buckets
 *  ({@link FIGHT_EXPERIENCE_TYPE}) have no record of their own, so a fight swing accrues this track's factor
 *  into the weapon's bucket. Soldiers ({@link isSoldierJob}) also accrue the track itself - the `needforjob`
 *  gates for the base soldier classes read it (viking `needforjob 31/32/34/40 5 69`). */
export const SOLDIER_GENERAL_EXPERIENCE_TYPE = 69;

/** The `hero general` track (`type 70`, factor 1 in the base data) - the sibling of
 *  {@link SOLDIER_GENERAL_EXPERIENCE_TYPE} the hero-variant `needforjob` gates read. Only job 42 owns the
 *  track in content, so every {@link isHeroJob} hero accrues it by role, not through `generalTrackFor`. */
export const HERO_GENERAL_EXPERIENCE_TYPE = 70;

/**
 * The fight-XP bucket a weapon of coarse class `weaponMainType` ({@link WEAPON_MAIN_TYPE}) accrues into -
 * its {@link FIGHT_EXPERIENCE_TYPE} (unarmed→FIST, spear→SPEAR, sword→SWORD, axe→AXE, bow→BOW,
 * catapult→CATAPULT). Saber has no fight track in the data (no `JOB_EXPERIENCE_TYPE_FIGHT_SABER`), so a
 * saber swing maps to `undefined` - it accrues no fight XP (approximated, source basis).
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
export function fightExperienceTypeFor(weaponMainType: number): number | undefined {
  return FIGHT_EXPERIENCE_TYPE_BY_WEAPON_MAIN_TYPE.get(weaponMainType);
}

/**
 * Grant an attacker fight XP for a damaging swing - accrue the {@link SOLDIER_GENERAL_EXPERIENCE_TYPE}
 * track's `experienceFactor` (1/swing in the base data) into the bucket for the swinging weapon's class
 * ({@link fightExperienceTypeFor}). The combat sibling of {@link grantWorkExperience}: where work XP trains
 * a `(job, good)` specialization, a fight swing trains the weapon class, so better soldier classes unlock
 * through the same accrued-XP gate.
 *
 * A fighter attacker additionally accrues its role's general track (soldier→69, hero→70) - the
 * `needforjob` gates for the base soldier classes and hero variants read those tracks, and the role grant
 * stays independent of the bucket so a saber fighter (no weapon bucket) still feeds its class gates.
 *
 * No-ops when: the weapon has no `mainType` (an unarmed/mainType-less combatant), the attacker is gone,
 * or the attacker is wildlife (an animal-tribe Settler - progression is a civilization mechanic, so a
 * wolf's bite stays flat instead of leveling its natural weapon toward the +50% mastery bonus).
 * The bucket half is skipped for a weapon class with no fight track (saber) or when content carries no
 * `soldier general` track (rate 0); the band half is skipped for civilians and absent tracks.
 *
 * Approximated: the accrual trigger (per-damaging-swing) has no readable oracle - the original may accrue
 * per swing or per kill; per-damaging-swing is the deterministic reading. The XP→level→stat curve (the
 * combat bonuses a level grants) is a later calibration slice (source basis).
 */
export function grantFightExperience(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  weaponMainType: number | undefined,
): void {
  if (weaponMainType === undefined) return; // an unarmed / mainType-less weapon trains no fight class
  const s = world.tryGet(attacker, Settler);
  if (s === undefined) return; // attacker gone
  if (isAnimalTribe(ctx.content, s.tribe)) return; // wildlife never levels - see the no-op list above
  const bucket = fightExperienceTypeFor(weaponMainType);
  const rate = fightExperienceRate(ctx);
  if (bucket !== undefined && rate > 0) accrueExperience(s, bucket, rate);
  const generalTrackId = isSoldierJob(ctx.content, s.jobType)
    ? SOLDIER_GENERAL_EXPERIENCE_TYPE
    : isHeroJob(ctx.content, s.jobType)
      ? HERO_GENERAL_EXPERIENCE_TYPE
      : undefined;
  if (generalTrackId === undefined) return; // a civilian swing trains only the weapon bucket
  const general = contentIndex(ctx.content).jobExperience.get(generalTrackId);
  if (general !== undefined) accrueExperience(s, generalTrackId, general.experienceFactor);
}

/** The per-swing fight-XP rate - the {@link SOLDIER_GENERAL_EXPERIENCE_TYPE} track's `experienceFactor`
 *  (1 in the base data), or `0` when content carries no such track. A pure content read. */
function fightExperienceRate(ctx: SystemContext): number {
  const track = contentIndex(ctx.content).jobExperience.get(SOLDIER_GENERAL_EXPERIENCE_TYPE);
  return track?.experienceFactor ?? 0;
}
