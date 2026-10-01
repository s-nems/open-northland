import type { ContentSet } from '@open-northland/data';
import {
  Age,
  Health,
  hasMissionBehaviour,
  isAboardVehicle,
  MISSION_BEHAVIOUR,
  type NeedDrain,
  needsEnabled,
  ownerOf,
  Person,
  Settler,
  SettlerNeeds,
  type SettlerNeedsView,
  type SettlerView,
} from '../../../components/index.js';
import { type Fixed, ONE, ZERO } from '../../../core/fixed.js';
import type { Rng } from '../../../core/rng.js';
import type { Entity, World } from '../../../ecs/world.js';
import { handlerTurn, scriptedSeatOnTurn } from '../../ai-player/cadence.js';
import type { System, SystemContext } from '../../context.js';
import { woundBearer } from '../../equipment/index.js';
import { declaresNoTrades, isFighterJob, isHeroJob } from '../../readviews/index.js';
import { isAboardShip } from '../../readviews/vehicles.js';
import { drainReachesBand, mutNeeds, needLevel } from './levels.js';
import { applyNeedUnits, NEED_CRITICAL_THRESHOLD, NEED_RESERVE_UNITS, needBar } from './scale.js';
import { woundedPersonsOf } from './wounded.js';

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
  const s = world.mut(settler, SettlerNeeds);
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
  const s = mutNeeds(world, e, ctx.tick);
  s.hunger = applyNeedUnits(s.hunger, -(carrying ? roughness * CARRYING_HUNGER_FACTOR : roughness));
}

/** A hauled good doubles a barefoot step's hunger (`roughness << 1`). */
const CARRYING_HUNGER_FACTOR = 2;

/** Hitpoints a grown settler loses each tick while its food sits at zero. Original behavior. */
export const STARVATION_HITPOINTS_PER_TICK = 2;
/** Hitpoints any other settler below its max regains each tick. Original behavior. */
export const REGENERATION_HITPOINTS_PER_TICK = 1;

/** Original behavior: a person is near death at 720 of its 5000 hitpoints, and the original's one larger
 *  pool, 20000, keeps the same share, 144 per mille. */
const NEAR_DEATH_PER_MILLE = 144;
const PER_MILLE = 1000;

/** Whether a living person with `hitpoints` of a `max` pool is near death, the state the original warns
 *  its player about when the person carries no healing draught to save itself with. */
export function isNearDeath(hitpoints: number, max: number): boolean {
  return hitpoints > 0 && hitpoints * PER_MILLE <= max * NEAR_DEATH_PER_MILLE;
}

/**
 * The rise half of settler needs, plus the hitpoint step. `piety` is not touched here: it climbs only
 * through {@link chargeMilitaryPiety} and falls with a prayer or a temple's blessing.
 *
 * Only a grown settler of a trading tribe carries needs. Original behavior for the age gate: neither
 * the per-tick drain nor the urgent-need check applies unless the human is an adult, so the child
 * eat and sleep clips `tribetypes.ini` binds (`setatomic 3/4 8/10`) are ones a child is played, never ones
 * it seeks. A person of a recorded tribe with no `jobEnables` is skipped on an approximation: the maps place
 * the monster tribes as a seat's soldiers no building can employ, so their bars would only ever pin.
 *
 * Hitpoints move for everyone, fed or not: a settler whose hunger has pinned loses them until it eats or
 * the pool empties, and any other wounded settler regains them. With the needs rule off nobody hungers,
 * so everyone regains them as a fed settler does.
 */
export const needsSystem: System = (world, ctx) => {
  const before = ctx.tick - 1;
  if (!needsEnabled(world)) {
    haltAllDrains(world, before);
    // Nobody hungers, so only the wounded move: the pass reads them alone.
    for (const e of woundedPersonsOf(world)) {
      if (!frozenInCart(world, ctx, e)) stepHealth(world, ctx, e, undefined, undefined);
    }
    return;
  }
  drainsHalted.delete(world);
  const refilling = seatRefillingAt(world, ctx.tick);
  for (const e of world.query(Person)) {
    if (frozenInCart(world, ctx, e)) {
      setDrain(world, e, 'none', before);
      continue;
    }
    if (refilling !== null && ownerOf(world, e) === refilling) refillCriticalNeeds(world, ctx, e, before);
    const settler = world.tryGet(e, Settler);
    const carries = settler !== undefined && settlerCarriesNeeds(world, ctx.content, e, settler);
    const drain: NeedDrain = !carries ? 'none' : isFighterJob(ctx.content, settler.jobType) ? 'body' : 'all';
    const needs = drainNeeds(world, ctx.tick, e, drain);
    stepHealth(world, ctx, e, carries ? needLevel(needs, 'hunger', ctx.tick) : undefined, settler);
  }
};

/**
 * The worlds whose bars were all stopped since needs were last on, so a disabled pass stops them once
 * rather than every tick. Only the enabled pass starts a drain, and a world missing here is scanned again,
 * so the memo cannot change a bar.
 */
const drainsHalted = new WeakMap<World, true>();

function haltAllDrains(world: World, drainedThrough: number): void {
  if (drainsHalted.has(world)) return;
  for (const e of world.query(SettlerNeeds)) setDrain(world, e, 'none', drainedThrough);
  drainsHalted.set(world, true);
}

/** Store `e`'s bars as of `drainedThrough` under a new drain, leaving them unwritten when it holds. */
function setDrain(world: World, e: Entity, drain: NeedDrain, drainedThrough: number): void {
  const needs = world.tryGet(e, SettlerNeeds);
  if (needs === undefined || needs.drain === drain) return;
  const s = mutNeeds(world, e, drainedThrough);
  s.drain = drain;
}

/** Frozen inside a cart, hitpoints included (approximation); a ship's passengers eat and sleep aboard. */
function frozenInCart(world: World, ctx: SystemContext, e: Entity): boolean {
  return isAboardVehicle(world, e) && !isAboardShip(world, ctx.content, e);
}

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
 *  hold the bar, as the original sets the bars directly. Company and piety are left to fall. Reads the bars
 *  before this tick's drain. */
function refillCriticalNeeds(world: World, ctx: SystemContext, e: Entity, drainedThrough: number): void {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || !isFighterJob(ctx.content, settler.jobType)) return;
  const needs = world.get(e, SettlerNeeds);
  const hungry = needLevel(needs, 'hunger', drainedThrough) > NEED_CRITICAL_THRESHOLD;
  const tired = needLevel(needs, 'fatigue', drainedThrough) > NEED_CRITICAL_THRESHOLD;
  if (!hungry && !tired) return;
  const s = mutNeeds(world, e, drainedThrough);
  if (hungry) s.hunger = ZERO;
  if (tired) s.fatigue = ZERO;
}

/** Whether `e`'s bars move at all - the one gate the drain and the clip events share. */
export function carriesNeeds(world: World, content: ContentSet, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && settlerCarriesNeeds(world, content, e, settler);
}

function settlerCarriesNeeds(world: World, content: ContentSet, e: Entity, settler: SettlerView): boolean {
  return (
    !hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NEEDS_FROZEN) &&
    !world.has(e, Age) &&
    !isHeroJob(content, settler.jobType) &&
    !declaresNoTrades(content, settler.tribe)
  );
}

/**
 * Run this tick's drain pass over `e`: a changed drain stores the bars as they stood before it, and a bar
 * the pass raises onto a band threshold is stored as it now stands; every other tick leaves the
 * component unwritten, its bars derived from the stored ones. Hands back the bars for the hitpoint step.
 */
function drainNeeds(world: World, tick: number, e: Entity, drain: NeedDrain): SettlerNeedsView {
  let needs = world.get(e, SettlerNeeds);
  if (needs.drain !== drain) {
    const s = mutNeeds(world, e, tick - 1);
    s.drain = drain;
    needs = s;
  }
  return drainReachesBand(needs, tick) ? mutNeeds(world, e, tick) : needs;
}

/**
 * One hitpoint step: starvation for a grown settler whose hunger has pinned, healing for anyone else below
 * a full pool. Intentional deviation from the original: a jobless settler never starves, since the eat
 * drive lives in the job planner, which skips it, so nothing could feed it. The 0-HP reap is
 * CleanupSystem's.
 */
function stepHealth(
  world: World,
  ctx: SystemContext,
  e: Entity,
  hunger: Fixed | undefined,
  settler: SettlerView | undefined,
): void {
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints <= 0) return;
  if (hunger === ONE && settler?.jobType !== null) {
    if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.INVULNERABLE)) return;
    woundBearer(world, ctx, e, STARVATION_HITPOINTS_PER_TICK);
    return;
  }
  if (health.hitpoints >= health.max) return;
  world.mut(e, Health).hitpoints = Math.min(health.max, health.hitpoints + REGENERATION_HITPOINTS_PER_TICK);
}
