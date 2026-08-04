import type { ContentSet, HumanJobExperienceType } from '@open-northland/data';
import { isWildlife, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { WEAPON_MAIN_TYPE } from '../readviews/combat.js';
import { declaresNoTrades, isHeroJob, isScoutJob, isSoldierJob } from '../readviews/index.js';
import { isCarrierJob, type WorkplaceOperators } from '../stores/index.js';

/**
 * XP accrual: a settler gets better at the specialization it works. Experience is granted within a narrow
 * `(job, good)` pairing (`humanjobexperiencetypes`, e.g. "collector wood" = job 8 + good 5), not just per
 * job, so repeating the same work on the same good is what makes an expert.
 *
 * These are helpers called from the atomic executor rather than a per-tick `System`: XP accrues the
 * instant a work atomic completes, and sim events are render-only, so the grant lives where the
 * completion is known. XP is a whole-number counter on the original's integer scale.
 */

/**
 * The `(job, good)` experience track a completed work atomic accrues into, or `undefined` when none
 * matches. A good-specific track must match both ids and is preferred over the job's general track, which
 * matches the job whatever the good.
 */
export function trackFor(
  ctx: SystemContext,
  jobType: number,
  goodType: number,
): HumanJobExperienceType | undefined {
  let general: HumanJobExperienceType | undefined;
  for (const t of ctx.content.jobExperience) {
    if (t.jobType !== jobType) continue;
    if (t.goodType === goodType) return t;
    if (t.goodType === undefined && general === undefined) general = t;
  }
  return general;
}

/**
 * Strokes one unit of output costs this `(job, good)` pairing - the track's extracted
 * `baserepeatcounter` (`humanjobexperiencetypes.ini`: hunter 5, farmer wheat 2, fisher 5) read as
 * strokes-per-action. The reading is indirect but calibrated: the farm's measured throughput of ~10 grain
 * per farmer per 10 min lands with 2 strokes and would not with 1 or 4. Never below one stroke.
 */
export function workRepeatsFor(ctx: SystemContext, jobType: number | null, goodType: number): number {
  if (jobType === null) return 1;
  return Math.max(1, trackFor(ctx, jobType, goodType)?.baseRepeatCounter ?? 1);
}

/**
 * Grant a settler XP for `units` of `goodType` its completed work atomic actually extracted, adding the
 * matched track's `experienceFactor` (the original's per-track accrual rate, 1..250 in the base data) per
 * unit. Authored: XP counts resource units gathered, never swings, so a felled trunk trains its whole
 * yield at once, and work trains only the matched track, so digging stone never advances the clay
 * specialization. A gate keyed to a job-general track stays reachable because {@link requirementRepeats}
 * counts it as the job's total repeats across all its tracks.
 */
export function grantWorkExperience(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  goodType: number,
  units: number,
): void {
  if (units <= 0) return;
  const s = world.tryGet(settler, Settler);
  if (s === undefined || s.jobType === null) return;
  const track = trackFor(ctx, s.jobType, goodType);
  if (track === undefined) return;
  accrueExperience(s, track.typeId, track.experienceFactor * units);
}

/** Accrue `amount` XP into a settler's `trackId` specialization bucket - the shared tail of the work- and
 *  fight-XP grants. */
function accrueExperience(s: { experience: Map<number, number> }, trackId: number, amount: number): void {
  if (amount <= 0) return; // a zero-rate track must not plant a hash-visible bucket with no meaning
  s.experience.set(trackId, (s.experience.get(trackId) ?? 0) + amount);
}

/** A job's general (no-good) experience track, or `undefined` when the job trains none; unlike
 *  {@link trackFor} it never resolves a good-specific track. */
export function generalTrackFor(ctx: SystemContext, jobType: number): HumanJobExperienceType | undefined {
  return ctx.content.jobExperience.find((t) => t.jobType === jobType && t.goodType === undefined);
}

/**
 * Grant production XP for a workplace's completed batches: one batch trains one present operator, in
 * canonical order and never more than are on station, on its job-general track. Authored: a trade trains
 * its profession whatever it crafted, and carrier operators are excluded because a carrier-run utility
 * trains only on deliveries. Per-completed-batch is the deterministic reading of the original's undecoded
 * accrual trigger (approximation).
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
    if (s === undefined || s.jobType === null) continue;
    if (isCarrierJob(ctx, s.jobType)) continue;
    const track = generalTrackFor(ctx, s.jobType);
    if (track === undefined) continue;
    accrueExperience(s, track.typeId, track.experienceFactor);
  }
}

/**
 * Grant a settler carry XP for one delivery that landed in a store, accruing the `carrier general`
 * track's `experienceFactor`. Authored: everyone hauls sometimes, but only the transport trade trains on
 * it, and a blocked deposit or flag drop trains nothing. Per-landed-delivery is the same deterministic
 * reading of the original's undecoded trigger as the batch grant above.
 */
export function grantCarryExperience(world: World, ctx: SystemContext, settler: Entity): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined || s.jobType === null || !isCarrierJob(ctx, s.jobType)) return;
  const track = generalTrackFor(ctx, s.jobType);
  if (track === undefined) return;
  accrueExperience(s, track.typeId, track.experienceFactor);
}

/**
 * The scout's signpost-craft bucket, an extension: the original gives the scout no experience track at
 * all, but here every erected signpost trains it (authored). Rate 1 per post, so raw XP is the repeat
 * count. The id sits outside the original's experience-type space (`logicdefines.inc`
 * `JOB_EXPERIENCE_TYPE_MAXIMUM` is 78), so no extracted track can collide.
 */
export const SCOUT_EXPERIENCE_TYPE = 100;

/** Grant a scout one signpost-craft XP for a guidepost it actually erected; the caller checks the post
 *  stood. Only the scout trade trains it. */
export function grantScoutExperience(world: World, content: ContentSet, settler: Entity): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined || !isScoutJob(content, s.jobType)) return;
  accrueExperience(s, SCOUT_EXPERIENCE_TYPE, 1);
}

/**
 * The TRAINING bucket every `trainfor*` requirement row reads (source basis: each tribe's
 * `trainforjob`/`trainforgood` rows name expType 77 and nothing else does). Nothing accrues it: a
 * barracks drill banks no experience stat, it flips the trade directly at the drill's end, so the rows
 * naming this bucket act as an always-closed gate on every other door into a fighter trade.
 */
export const TRAINING_EXPERIENCE_TYPE = 77;

/**
 * The per-weapon-class fight buckets combat XP accrues into (`logicdefines.inc`
 * `JOB_EXPERIENCE_TYPE_FIGHT_*`, l.598-603), in the same expType id space the `needfor*` soldier-upgrade
 * gates read: the viking iron-spear soldier requires `SPEAR` (72), the long-sword soldier `SWORD` (73),
 * the long-bow soldier `BOW` (75). These ids back no `HumanJobExperienceType` record, so the accrual rate
 * comes from {@link SOLDIER_GENERAL_EXPERIENCE_TYPE}.
 */
export const FIGHT_EXPERIENCE_TYPE = {
  FIST: 71,
  SPEAR: 72,
  SWORD: 73,
  AXE: 74,
  BOW: 75,
  CATAPULT: 76,
} as const;

/** The `humanjobexperiencetypes` track whose `experienceFactor` sets the per-swing fight-XP rate: the
 *  `soldier general` track (`type 69`, factor 1 in the base data). Soldiers accrue the track itself too,
 *  since the base classes' `needforjob` gates read it (viking `needforjob 31/32/34/40 5 69`). */
export const SOLDIER_GENERAL_EXPERIENCE_TYPE = 69;

/** The `hero general` track (`type 70`, factor 1 in the base data) the hero-variant `needforjob` gates
 *  read. Only job 42 owns it in content, so every hero accrues it by role, not through
 *  `generalTrackFor`. */
export const HERO_GENERAL_EXPERIENCE_TYPE = 70;

/**
 * The fight-XP bucket each weapon class accrues into. Saber has no fight track in the data (no
 * `JOB_EXPERIENCE_TYPE_FIGHT_SABER`), so a saber swing accrues no fight XP.
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
 * The fight-experience bucket a `weaponMainType` accrues into, or `undefined` when the weapon has no
 * fight track: a saber, or a `mainType` outside {@link WEAPON_MAIN_TYPE}.
 */
export function fightExperienceTypeFor(weaponMainType: number): number | undefined {
  return FIGHT_EXPERIENCE_TYPE_BY_WEAPON_MAIN_TYPE.get(weaponMainType);
}

/**
 * Grant an attacker fight XP for a damaging swing: the {@link SOLDIER_GENERAL_EXPERIENCE_TYPE} rate into
 * the swinging weapon's class bucket, plus the attacker's own role track (soldier 69, hero 70), which the
 * `needforjob` gates read. The role grant stays independent of the bucket, so a saber fighter with no
 * weapon bucket still feeds its class gates. Wildlife never levels: a wolf's bite stays flat.
 *
 * Approximated: the accrual trigger has no readable oracle - the original may accrue per swing or per
 * kill, and per-damaging-swing is the deterministic reading.
 */
export function grantFightExperience(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  weaponMainType: number | undefined,
): void {
  if (weaponMainType === undefined) return;
  const s = world.tryGet(attacker, Settler);
  if (s === undefined) return;
  if (isWildlife(world, attacker)) return;
  // A tribe with no `jobEnables` reaches no rung, so the points would be hashed state nothing reads.
  if (declaresNoTrades(ctx.content, s.tribe)) return;
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

/** The per-swing fight-XP rate: the {@link SOLDIER_GENERAL_EXPERIENCE_TYPE} track's `experienceFactor`
 *  (1 in the base data), or `0` when content carries no such track. */
function fightExperienceRate(ctx: SystemContext): number {
  const track = contentIndex(ctx.content).jobExperience.get(SOLDIER_GENERAL_EXPERIENCE_TYPE);
  return track?.experienceFactor ?? 0;
}
