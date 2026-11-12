import {
  type ContentSet,
  DEFAULT_BASE_REPEAT_COUNTER,
  type HumanJobExperienceType,
} from '@open-northland/data';
import {
  hasMissionBehaviour,
  isWildlife,
  MISSION_BEHAVIOUR,
  noteSettlerProgress,
  Settler,
  SettlerProgress,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { WEAPON_MAIN_TYPE } from '../readviews/combat.js';
import { declaresNoTrades, isHeroJob, isTraderJob } from '../readviews/index.js';
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
 * A novice's strokes per unit for this `(job, good)` pairing: the track's `baserepeatcounter`, the base
 * that `strokesPerUnit` cuts down by experience and tool. A pairing no track covers costs the record
 * default, as in the original. Never below one stroke.
 */
export function workRepeatsFor(ctx: SystemContext, jobType: number | null, goodType: number): number {
  if (jobType === null) return DEFAULT_BASE_REPEAT_COUNTER;
  return Math.max(1, trackFor(ctx, jobType, goodType)?.baseRepeatCounter ?? DEFAULT_BASE_REPEAT_COUNTER);
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

/**
 * A placed settler's starting experience as a `spawnSettler` payload: each `(track, repeats)` line in the
 * factor-scaled encoding, a repeated track summed under its cap. A track content lacks counts raw, as the
 * `needfor*` readers count it. A line on one of the original's per-weapon-class fight buckets counts points
 * of the personal fight counter, all such lines summed under {@link FIGHT_EXPERIENCE_FULL}.
 * Original behavior: a map's `setexpierence` is skipped for a hero, counts in `needfor*` units and adds
 * to the same per-track counter whether or not a track record exists.
 */
export function startingExperience(
  content: ContentSet,
  jobType: number,
  lines: readonly { readonly track: number; readonly amount: number }[],
): [number, number][] {
  if (isHeroJob(content, jobType)) return [];
  const xp = new Map<number, number>();
  for (const { track, amount } of lines) {
    if (amount <= 0) continue;
    const id = CLASS_FIGHT_EXPERIENCE_TYPES.has(track) ? FIGHT_EXPERIENCE_TYPE.PERSONAL : track;
    const personal = id === FIGHT_EXPERIENCE_TYPE.PERSONAL;
    const factor = personal
      ? FIGHT_EXPERIENCE_UNITS_PER_POINT
      : (contentIndex(content).jobExperience.get(id)?.experienceFactor ?? RAW_EXPERIENCE_FACTOR);
    const cap = personal ? FIGHT_EXPERIENCE_FULL_UNITS : factor * MAX_EXPERIENCE_REPEATS;
    xp.set(id, Math.min(cap, (xp.get(id) ?? 0) + factor * amount));
  }
  return [...xp].filter(([, amount]) => amount > 0);
}

/** The factor of a track no record describes: one raw point per counted action. */
const RAW_EXPERIENCE_FACTOR = 1;

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
 * The fight-experience buckets, which back no `HumanJobExperienceType` record. Our rule, a departure from
 * the original's per-weapon-class buckets: every person keeps one personal fight counter that every
 * weapon but the catapult trains and reads, so a change of weapon keeps it. `PERSONAL` is our own id, past
 * the original's fight and training buckets (71..77), so no map line or content track names it. The
 * catapult keeps its own bucket (`logicdefines.inc` `JOB_EXPERIENCE_TYPE_FIGHT_CATAPULT`), read raw as the
 * commander's aim.
 */
export const FIGHT_EXPERIENCE_TYPE = {
  PERSONAL: 78,
  CATAPULT: 76,
} as const;

/**
 * The original's per-weapon-class fight buckets (`logicdefines.inc` `JOB_EXPERIENCE_TYPE_FIGHT_*`: fist
 * 71, spear 72, sword 73, axe 74, bow 75). Only a map's `setexpierence` lines still name them, and
 * {@link startingExperience} folds those into the personal counter.
 */
const CLASS_FIGHT_EXPERIENCE_TYPES: ReadonlySet<number> = new Set([71, 72, 73, 74, 75]);

/** The raw XP the catapult bucket gains per landed hit. Original behavior. */
const CATAPULT_EXPERIENCE_PER_HIT = 1;
/** Full fight experience: the points the personal counter holds at most. Our rule. */
export const FIGHT_EXPERIENCE_FULL = 100;
/** The raw XP the catapult bucket holds at most. Original behavior. */
export const CATAPULT_EXPERIENCE_MAX = 10_000;

/**
 * The fine units the personal fight counter stores per point, so a part of a point is kept. Our rule: 48
 * makes every blow-time rate below a whole number of units per tick at {@link TICKS_PER_SECOND}. Read the
 * counter only through `personalFightPoints` (whole points) or `personalFightUnits` (`bonus.ts`).
 */
export const FIGHT_EXPERIENCE_UNITS_PER_POINT = 48;
/** {@link FIGHT_EXPERIENCE_FULL} in the counter's stored units. */
export const FIGHT_EXPERIENCE_FULL_UNITS = FIGHT_EXPERIENCE_FULL * FIGHT_EXPERIENCE_UNITS_PER_POINT;

/** `points` of the personal fight counter in its stored units. */
export function fightUnitsOfPoints(points: number): number {
  return points * FIGHT_EXPERIENCE_UNITS_PER_POINT;
}

/** A blow-time rate: `points` earned per `seconds` of the attack clip a blow stands for. */
export interface FightPointsRate {
  readonly points: number;
  readonly seconds: number;
}

/**
 * Our rule: fight points are earned by blow time, not per blow, so a slow weapon earns as fast as a quick
 * one. A landed melee blow earns its striker 3/4 point per second of his own attack clip, a landed shot
 * 1/2 point per second of the shooter's, and every damaging blow on a person earns him 1/2 point per
 * second of the attacker's clip, whoever the attacker is.
 */
export const MELEE_BLOW_POINTS_RATE: FightPointsRate = { points: 3, seconds: 4 };
export const SHOT_POINTS_RATE: FightPointsRate = { points: 1, seconds: 2 };
export const BLOW_TAKEN_POINTS_RATE: FightPointsRate = { points: 1, seconds: 2 };

/** The stored units `rate` earns per tick of attack clip; whole by the choice of
 *  {@link FIGHT_EXPERIENCE_UNITS_PER_POINT}. */
export function fightUnitsPerClipTick(rate: FightPointsRate): number {
  return (FIGHT_EXPERIENCE_UNITS_PER_POINT * rate.points) / (rate.seconds * TICKS_PER_SECOND);
}

/** How a landed blow was delivered, which picks its striker's blow-time rate. */
export type FightBlowDelivery = 'melee' | 'shot';

/** What a landed blow struck: a person or an animal, or a structure (a building, a wall or palisade
 *  piece, a vehicle). */
export type FightBlowTarget = 'living' | 'structure';

/**
 * Our rule: a blow or shot that lands on a structure earns its striker a quarter of what the same blow
 * earns on a living target. A quarter of a blow's units is whole only for a clip length that divides out
 * (a multiple of 4 ticks for melee, an even one for a shot), so it is rounded down: at most 3/4 of a unit,
 * 1/64 point, is lost per blow.
 */
export const STRUCTURE_BLOW_SHARE = { numerator: 1, denominator: 4 } as const;

/** The stored units a whole attack clip of `clipTicks` at `rate` earns its striker on `target`. */
export function strikerFightUnits(rate: FightPointsRate, clipTicks: number, target: FightBlowTarget): number {
  const units = clipTicks * fightUnitsPerClipTick(rate);
  if (target === 'living') return units;
  return Math.floor((units * STRUCTURE_BLOW_SHARE.numerator) / STRUCTURE_BLOW_SHARE.denominator);
}

/** Which of its clip's `events` attack events a blow is (`event` counts from 0). A clip that lands several
 *  blows earns its blow time once, shared across them. */
export interface BlowShare {
  readonly event: number;
  readonly events: number;
}

/** A blow that stands for its whole clip: the only attack event, a shot from no clip, a building's. */
export const WHOLE_CLIP: BlowShare = { event: 0, events: 1 };

/**
 * Event `share.event`'s part of a whole clip's `units`: the clip's units cut at `floor(units * k / events)`,
 * so the events of one clip sum to exactly the clip's units and a remainder unit falls to a later event.
 */
export function sharedFightUnits(units: number, share: BlowShare): number {
  const { event, events } = share;
  return Math.floor((units * (event + 1)) / events) - Math.floor((units * event) / events);
}

/**
 * The fight-experience bucket a `weaponMainType` accrues into: the catapult's own, the personal counter for
 * every other weapon class, and `undefined` for no class. Our rule: the original trains no bucket with a
 * saber or the hero axe; here every personal weapon trains the one counter.
 */
export function fightExperienceTypeFor(weaponMainType: number): number | undefined {
  if (weaponMainType === WEAPON_MAIN_TYPE.CATAPULT) return FIGHT_EXPERIENCE_TYPE.CATAPULT;
  return weaponMainType === WEAPON_MAIN_TYPE.NONE ? undefined : FIGHT_EXPERIENCE_TYPE.PERSONAL;
}

/** Whether fighting may train `e` at all. Wildlife never levels, and a tribe with no `jobEnables` reaches
 *  no rung, so the points would be hashed state nothing reads. */
function earnsFightExperience(world: World, ctx: SystemContext, e: Entity): boolean {
  const s = world.tryGet(e, Settler);
  return s !== undefined && !isWildlife(world, e) && !declaresNoTrades(ctx.content, s.tribe);
}

/**
 * Grant an attacker fight XP for a landed hit, melee or ranged. The catapult bucket gains one raw point
 * per hit under {@link CATAPULT_EXPERIENCE_MAX}; the personal counter gains the blow time of `clipTicks`,
 * the attacker's own attack clip, at the `delivery`'s rate and the `target`'s share
 * ({@link strikerFightUnits}), cut to this blow's `share` of the clip, under {@link FIGHT_EXPERIENCE_FULL_UNITS}.
 */
export function grantFightExperience(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  weaponMainType: number | undefined,
  delivery: FightBlowDelivery,
  clipTicks: number,
  target: FightBlowTarget,
  share: BlowShare,
): void {
  if (weaponMainType === undefined) return;
  if (!earnsFightExperience(world, ctx, attacker)) return;
  const bucket = fightExperienceTypeFor(weaponMainType);
  if (bucket === FIGHT_EXPERIENCE_TYPE.CATAPULT) {
    accrueExperience(world, attacker, bucket, CATAPULT_EXPERIENCE_PER_HIT, CATAPULT_EXPERIENCE_MAX);
  } else if (bucket === FIGHT_EXPERIENCE_TYPE.PERSONAL) {
    const rate = delivery === 'melee' ? MELEE_BLOW_POINTS_RATE : SHOT_POINTS_RATE;
    const units = sharedFightUnits(strikerFightUnits(rate, clipTicks, target), share);
    accrueExperience(world, attacker, bucket, units, FIGHT_EXPERIENCE_FULL_UNITS);
  }
}

/** Grant person `victim` the personal fight XP of a blow that wounded him: his `share` of the blow time of
 *  `clipTicks`, the attacker's attack cadence, at {@link BLOW_TAKEN_POINTS_RATE}. */
export function grantBlowTakenExperience(
  world: World,
  ctx: SystemContext,
  victim: Entity,
  clipTicks: number,
  share: BlowShare,
): void {
  if (!earnsFightExperience(world, ctx, victim)) return;
  const units = sharedFightUnits(clipTicks * fightUnitsPerClipTick(BLOW_TAKEN_POINTS_RATE), share);
  accrueExperience(world, victim, FIGHT_EXPERIENCE_TYPE.PERSONAL, units, FIGHT_EXPERIENCE_FULL_UNITS);
}

/** Add a coin drill's `points` to `settler`'s personal fight counter, capped at {@link FIGHT_EXPERIENCE_FULL}.
 *  A script that bars him from getting better (`MISSIONS.md`, behaviour bit 11) bars this too. */
export function grantDrillPoints(world: World, settler: Entity, points: number): void {
  accrueExperience(
    world,
    settler,
    FIGHT_EXPERIENCE_TYPE.PERSONAL,
    fightUnitsOfPoints(points),
    FIGHT_EXPERIENCE_FULL_UNITS,
  );
}
