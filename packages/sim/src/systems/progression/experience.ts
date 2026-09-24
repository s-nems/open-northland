import type { ContentSet, HumanJobExperienceType } from '@open-northland/data';
import {
  hasMissionBehaviour,
  isWildlife,
  MISSION_BEHAVIOUR,
  noteSettlerProgress,
  Settler,
  SettlerProgress,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { WEAPON_MAIN_TYPE } from '../readviews/combat.js';
import { declaresNoTrades, isHeroJob, isScoutJob, isSoldierJob, isTraderJob } from '../readviews/index.js';
import { isCarrierJob, type WorkplaceOperators } from '../stores/index.js';

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
    if (t.goodTypes.includes(goodType)) return t;
    if (t.goodTypes.length === 0 && general === undefined) general = t;
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

/** The cap on any track, in repeats; the saved value is the repeat count times the track's factor. */
export const MAX_EXPERIENCE_REPEATS = 10_000;

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
  accrueTrack(world, settler, track, units);
  const general = generalTrackFor(ctx, s.jobType);
  if (general !== undefined && general.typeId !== track.typeId) accrueTrack(world, settler, general, units);
}

/** A script may bar a unit from ever getting better at its trade (`MISSIONS.md`, behaviour bit 11). */
function accrueExperience(
  world: World,
  settler: Entity,
  trackId: number,
  amount: number,
  limit = MAX_EXPERIENCE_REPEATS,
): void {
  if (hasMissionBehaviour(world, settler, MISSION_BEHAVIOUR.NO_JOB_EXPERIENCE)) return;
  if (amount <= 0) return; // a zero-rate track must not plant a hash-visible bucket with no meaning
  const held = world.get(settler, SettlerProgress).experience.get(trackId) ?? 0;
  const next = Math.min(limit, held + amount);
  if (next === held) return; // a capped track
  world.mut(settler, SettlerProgress).experience.set(trackId, next);
  noteSettlerProgress(world, settler);
}

/** `units` repeats on a content track, in the track's factor-scaled encoding and under its cap. */
function accrueTrack(world: World, settler: Entity, track: HumanJobExperienceType, units = 1): void {
  accrueExperience(
    world,
    settler,
    track.typeId,
    track.experienceFactor * units,
    track.experienceFactor * MAX_EXPERIENCE_REPEATS,
  );
}

/** A job's general (no-good) experience track, or `undefined` when the job trains none; unlike
 *  {@link trackFor} it never resolves a good-specific track. */
export function generalTrackFor(ctx: SystemContext, jobType: number): HumanJobExperienceType | undefined {
  return ctx.content.jobExperience.find((t) => t.jobType === jobType && t.goodTypes.length === 0);
}

/** One repeat on the general track of `jobType`, when the job trains one. */
function accrueGeneralTrack(world: World, ctx: SystemContext, settler: Entity, jobType: number): void {
  const track = generalTrackFor(ctx, jobType);
  if (track !== undefined) accrueTrack(world, settler, track);
}

export function grantProfessionExperience(world: World, ctx: SystemContext, entity: Entity): void {
  const job = world.tryGet(entity, Settler)?.jobType;
  if (job !== null && job !== undefined) accrueGeneralTrack(world, ctx, entity, job);
}

/** Each completed batch trains one present operator in its general and product-specific tracks. */
export function grantProductionExperience(
  world: World,
  ctx: SystemContext,
  batches: number,
  operators: WorkplaceOperators,
  products?: readonly number[],
): void {
  if (operators.kind === 'unstaffed') return;
  for (const [index, op] of operators.operators.slice(0, batches).entries()) {
    const s = world.tryGet(op, Settler);
    if (s === undefined || s.jobType === null || isCarrierJob(ctx, s.jobType)) continue;
    const product = products?.[index];
    if (product !== undefined) grantWorkExperience(world, ctx, op, product, 1);
    else accrueGeneralTrack(world, ctx, op, s.jobType);
  }
}

/**
 * Grant a settler carry XP for one delivery that landed in a store, accruing the `carrier general`
 * track's `experienceFactor`. Authored: everyone hauls sometimes, but only the transport trade trains on
 * it, and a blocked deposit or flag drop trains nothing. Per-landed-delivery is the same approximated
 * trigger as {@link grantProductionExperience}.
 */
export function grantCarryExperience(world: World, ctx: SystemContext, settler: Entity): void {
  const s = world.tryGet(settler, Settler);
  if (s !== undefined && s.jobType !== null && isCarrierJob(ctx, s.jobType))
    accrueGeneralTrack(world, ctx, settler, s.jobType);
}

/** The trader's twin of {@link grantCarryExperience}: one landed cart delivery accrues the `trader
 *  general` track (reading: the original's trader gains job experience on each delivery). */
export function grantTradeExperience(world: World, ctx: SystemContext, settler: Entity): void {
  const s = world.tryGet(settler, Settler);
  if (s !== undefined && s.jobType !== null && isTraderJob(ctx.content, s.jobType))
    accrueGeneralTrack(world, ctx, settler, s.jobType);
}

/**
 * The scout's signpost-craft bucket, an extension: the original gives the scout no experience track at
 * all, but here every erected signpost trains it (authored). Rate 1 per post, so raw XP is the repeat
 * count. The id sits outside the original's experience-type space (`logicdefines.inc`
 * `JOB_EXPERIENCE_TYPE_MAXIMUM` is 78), so no extracted track can collide.
 */
export const SCOUT_EXPERIENCE_TYPE = 100;

/** Grant a scout one signpost-craft XP for a guidepost it actually erected; the caller checks the post
 *  stood. */
export function grantScoutExperience(world: World, content: ContentSet, settler: Entity): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined || !isScoutJob(content, s.jobType)) return;
  accrueExperience(world, settler, SCOUT_EXPERIENCE_TYPE, 1);
}

/**
 * The TRAINING bucket every `trainfor*` requirement row reads (source basis: each tribe's
 * `trainforjob`/`trainforgood` rows name expType 77 and nothing else does). Nothing accrues it - the
 * barracks drill flips the trade directly at its end - so the rows naming this bucket act as an
 * always-closed gate on every other door into a fighter trade.
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

/** Saber has no fight track in the data (no `JOB_EXPERIENCE_TYPE_FIGHT_SABER`), so it is absent here. */
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
 * track or its `mainType` falls outside {@link WEAPON_MAIN_TYPE}.
 */
export function fightExperienceTypeFor(weaponMainType: number): number | undefined {
  return FIGHT_EXPERIENCE_TYPE_BY_WEAPON_MAIN_TYPE.get(weaponMainType);
}

/**
 * Grant an attacker fight XP for a damaging swing: the {@link SOLDIER_GENERAL_EXPERIENCE_TYPE} rate into
 * the swinging weapon's class bucket, plus the attacker's own role track (soldier 69, hero 70), which the
 * `needforjob` gates read. The role grant stays independent of the bucket, so a saber fighter with no
 * weapon bucket still feeds its class gates. Wildlife never levels.
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
  if (bucket !== undefined && rate > 0) accrueExperience(world, attacker, bucket, rate);
  const generalTrackId = isSoldierJob(ctx.content, s.jobType)
    ? SOLDIER_GENERAL_EXPERIENCE_TYPE
    : isHeroJob(ctx.content, s.jobType)
      ? HERO_GENERAL_EXPERIENCE_TYPE
      : undefined;
  if (generalTrackId === undefined) return;
  const general = contentIndex(ctx.content).jobExperience.get(generalTrackId);
  if (general !== undefined) accrueTrack(world, attacker, general);
}

/** The per-swing fight-XP rate: the {@link SOLDIER_GENERAL_EXPERIENCE_TYPE} track's `experienceFactor`
 *  (1 in the base data), or `0` when content carries no such track. */
function fightExperienceRate(ctx: SystemContext): number {
  const track = contentIndex(ctx.content).jobExperience.get(SOLDIER_GENERAL_EXPERIENCE_TYPE);
  return track?.experienceFactor ?? 0;
}
