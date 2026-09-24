import type { ContentSet } from '@open-northland/data';
import {
  Age,
  Health,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  needsEnabled,
  ownerOf,
  Person,
  Settler,
  type SettlerView,
} from '../../../components/index.js';
import { type Fixed, ONE, ZERO } from '../../../core/fixed.js';
import type { Rng } from '../../../core/rng.js';
import type { Entity, World } from '../../../ecs/world.js';
import { handlerTurn, scriptedSeatOnTurn } from '../../ai-player/cadence.js';
import type { System, SystemContext } from '../../context.js';
import { tryDeathSaveDraught } from '../../equipment/index.js';
import { declaresNoTrades, isFighterJob, isHeroJob } from '../../readviews/index.js';
import {
  applyNeedUnits,
  NEED_CRITICAL_THRESHOLD,
  NEED_DRAIN_UNITS_PER_TICK,
  NEED_RESERVE_UNITS,
  needBar,
} from './scale.js';

/** The spread of a settler's starting deficit, half a bar, so a map opens with varied satisfaction instead
 *  of everyone identically full. Authored: per-settler starting needs are below the readable data. */
export const NEED_INIT_SPREAD_UNITS = NEED_RESERVE_UNITS / 2;

/** One seeded starting deficit in `[0, NEED_INIT_SPREAD_UNITS)` reserve units. */
export function rollInitialNeed(rng: Rng): Fixed {
  return needBar(rng.int(NEED_INIT_SPREAD_UNITS));
}

/** Move a settler's piety by `units` of the reserve, the sign the data writes: a forge clip's `-1500` or
 *  `-3000` spends it, a prayer's `+800` pulses serve it. */
export function chargeMilitaryPiety(world: World, settler: Entity, units: number): void {
  if (
    units === 0 ||
    !needsEnabled(world) ||
    hasMissionBehaviour(world, settler, MISSION_BEHAVIOUR.NEEDS_FROZEN)
  )
    return;
  if (!world.has(settler, Settler)) return;
  const s = world.mut(settler, Settler);
  s.piety = applyNeedUnits(s.piety, units);
}

/**
 * A barefoot step's hunger, at departure or terminal arrival: without live boots, the walker's
 * food bar loses that many reserve units, twice as many while hauling a good. The shoes' other promise
 * in the manual ("uses up less energy"). Original behavior: on reaching a new map position, a spent or
 * absent shoe condition sends `roughness << carrying` off the food field instead of the pair, on the same
 * 10000-unit bar the level table names, for an adult whose needs are not frozen. The sim also retains
 * {@link carriesNeeds}'s hero and non-settler-tribe exemptions, beyond the original's age and script
 * gates.
 */
export function chargeBarefootStep(
  world: World,
  ctx: SystemContext,
  e: Entity,
  roughness: number,
  carrying: boolean,
): void {
  if (roughness === 0 || !needsEnabled(world) || !carriesNeeds(world, ctx.content, e)) return;
  const s = world.mut(e, Settler);
  s.hunger = applyNeedUnits(s.hunger, -(carrying ? roughness * CARRYING_HUNGER_FACTOR : roughness));
}

/** A hauled good doubles a barefoot step's hunger (`roughness << 1`). */
const CARRYING_HUNGER_FACTOR = 2;

/**
 * Ticks a pinned hunger takes to empty a full `Health` pool, and ticks a fed settler takes to refill an
 * empty one. Original behavior: a human has a flat 5000-point pool, loses 2 a
 * tick while its food sits at zero and returns 1 a tick below the pool. Approximation: reading those two
 * spans against `Health.max` carries them to the pools authored here, where the original has only the one.
 */
export const STARVATION_TICKS_TO_DIE = 2500;
export const HEALING_TICKS_TO_FULL = STARVATION_TICKS_TO_DIE * 2;

/**
 * The whole hitpoints a pool of `max` moves on `tick` when it spends itself over `span` ticks. Differencing
 * a running total is exact for any integer pool without a remainder in component state, and cannot drift:
 * the total between two ticks depends on those ticks alone.
 */
function poolStepAt(max: number, span: number, tick: number): number {
  return Math.trunc(((tick + 1) * max) / span) - Math.trunc((tick * max) / span);
}

/**
 * The rise half of settler needs, plus the hitpoint step. `piety` is not touched here: it climbs only
 * through {@link chargeMilitaryPiety} and falls at a temple.
 *
 * Only a grown settler of a trading tribe carries needs. Original behavior for the age gate: neither
 * the per-tick drain nor the urgent-need check applies unless the human is an adult, so the child
 * eat and sleep clips `tribetypes.ini` binds (`setatomic 3/4 8/10`) are ones a child is played, never ones
 * it seeks. A person of a recorded tribe with no `jobEnables` is skipped on an approximation: the maps place
 * the monster tribes as a seat's soldiers no building can employ, so their bars would only ever pin.
 *
 * Hitpoints move for everyone, fed or not: a settler whose hunger has pinned loses them until it eats or
 * the pool empties, and any other wounded settler regains them.
 */
export const needsSystem: System = (world, ctx) => {
  if (!needsEnabled(world)) return;
  const refilling = seatRefillingAt(world, ctx.tick);
  for (const e of world.query(Person)) {
    if (refilling !== null && ownerOf(world, e) === refilling) refillCriticalNeeds(world, ctx, e);
    const settler = carriesNeeds(world, ctx.content, e) ? drainNeeds(world, ctx, e) : undefined;
    stepHealth(world, ctx, e, settler);
  }
};

/**
 * Handler turns between one computer seat's refills. Original behavior: the scripted AI handler
 * on every twelfth of its turns writes a full bar over every food and stamina bar of the seat's
 * soldiers and heroes that has dropped below the critical mark (it covers the seat's soldiers, heroes
 * and vehicle commanders). A civilian of the seat is left to its own seeking.
 * A bar sits below the critical mark for at most the minute before its seat's turn.
 */
export const AI_NEED_REFILL_TURNS = 12;

/** The computer seat whose refill lands on `tick`, or null on a tick that is no seat's. */
function seatRefillingAt(world: World, tick: number): number | null {
  if (handlerTurn(tick) % AI_NEED_REFILL_TURNS !== 0) return null;
  return scriptedSeatOnTurn(world, tick);
}

/** The refill itself: a fighter's hunger and fatigue only, written over whatever gate would otherwise
 *  hold the bar, as the original sets the bars directly. Company and piety are left to fall. */
function refillCriticalNeeds(world: World, ctx: SystemContext, e: Entity): void {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || !isFighterJob(ctx.content, settler.jobType)) return;
  const hungry = settler.hunger > NEED_CRITICAL_THRESHOLD;
  const tired = settler.fatigue > NEED_CRITICAL_THRESHOLD;
  if (!hungry && !tired) return;
  const s = world.mut(e, Settler);
  if (hungry) s.hunger = ZERO;
  if (tired) s.fatigue = ZERO;
}

/** Whether `e`'s bars move at all - the one gate the drain and the clip events share. */
export function carriesNeeds(world: World, content: ContentSet, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return (
    !hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NEEDS_FROZEN) &&
    settler !== undefined &&
    !world.has(e, Age) &&
    !isHeroJob(content, settler.jobType) &&
    !declaresNoTrades(content, settler.tribe)
  );
}

/** Drain one tick off the three needs time alone moves, and hand back the drained bars so the hitpoint
 *  step reads them without a second lookup; a fighter's company need is frozen instead. A settler whose
 *  bars have all pinned is left unwritten. */
function drainNeeds(world: World, ctx: SystemContext, e: Entity): SettlerView {
  const settler = world.get(e, Settler);
  const hunger = applyNeedUnits(settler.hunger, -NEED_DRAIN_UNITS_PER_TICK);
  const fatigue = applyNeedUnits(settler.fatigue, -NEED_DRAIN_UNITS_PER_TICK);
  const enjoyment = isFighterJob(ctx.content, settler.jobType)
    ? settler.enjoyment
    : applyNeedUnits(settler.enjoyment, -NEED_DRAIN_UNITS_PER_TICK);
  if (hunger === settler.hunger && fatigue === settler.fatigue && enjoyment === settler.enjoyment) {
    return settler;
  }
  const drained = world.mut(e, Settler);
  drained.hunger = hunger;
  drained.fatigue = fatigue;
  drained.enjoyment = enjoyment;
  return drained;
}

/**
 * One hitpoint step: starvation for a grown settler whose hunger has pinned, healing for anyone else off
 * a full pool. A jobless settler never starves: the eat drive lives in the job planner, which skips it, so
 * nothing could feed it. The 0-HP reap is CleanupSystem's.
 */
function stepHealth(world: World, ctx: SystemContext, e: Entity, settler: SettlerView | undefined): void {
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints <= 0) return;
  if (settler !== undefined && settler.hunger === ONE && settler.jobType !== null) {
    if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.INVULNERABLE)) return;
    const bite = poolStepAt(health.max, STARVATION_TICKS_TO_DIE, ctx.tick);
    if (bite === 0) return;
    // The healing draught's death-save may answer a lethal bite.
    if (health.hitpoints - bite <= 0 && tryDeathSaveDraught(world, ctx, e)) return;
    world.mut(e, Health).hitpoints = Math.max(0, health.hitpoints - bite);
    return;
  }
  if (health.hitpoints >= health.max) return;
  const heal = poolStepAt(health.max, HEALING_TICKS_TO_FULL, ctx.tick);
  if (heal === 0) return;
  world.mut(e, Health).hitpoints = Math.min(health.max, health.hitpoints + heal);
}
