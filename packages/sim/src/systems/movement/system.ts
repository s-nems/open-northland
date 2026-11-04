import {
  AnimalRunning,
  Engagement,
  Frightened,
  isWildlife,
  MoveSpeed,
  MoveStepPeriod,
  PathFollow,
  PathRoute,
  Position,
  pathLegTicks,
  Settler,
  WalkFacing,
  type Waypoint,
} from '../../components/index.js';
import { type Fixed, fx, ONE, ULP, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { DEFAULT_NODE_ROUGHNESS, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { HALF_COLUMN, HALF_ROW, ROW_STEP, worldDistance } from '../../nav/world-metric.js';
import { trafficCounter } from '../computer-player/traffic.js';
import type { System, SystemContext } from '../context.js';
import { wearWornBoots } from '../equipment/index.js';
import { chargeBarefootStep, drinkPressingDraughts } from '../lifecycle/needs/index.js';
import { locomotionOf } from '../readviews/index.js';
import { dropPath } from './nav-state.js';
import { emptyLegMeasure, measureLeg, stepAlongLeg, stepTowardPoint } from './stepping.js';
import { beginWalkTurn, finishWalkTurn } from './turning.js';
import {
  emptyWalkStepModifiers,
  hasLiveBoots,
  isCarryingGood,
  MAX_STEP_TICKS,
  MIN_STEP_TICKS,
  walkStepModifiersOf,
  walkStepTicks,
} from './walk-cost.js';

/**
 * The most a human advances in one tick, in world-metric column units: the column step, one full row
 * and the longest step a route takes, over the engine's floor on a step cost, rounded up so a floor-cost
 * column step still lands on its last tick. A leg paced under it never touches it, so it only bounds the catch-up after a
 * separation push, keeping the unit-separation impassability bound (`collision/separation.ts`) below the
 * body radius.
 */
export const MAX_STEP_PER_TICK: Fixed = fx.divCeil(ROW_STEP, fx.fromInt(MIN_STEP_TICKS));

/**
 * The reference human pace the separation approximations scale their caps by: a rested, barefoot,
 * unladen walker crossing land (roughness 2), 8 ticks a half-column step.
 */
export const REFERENCE_STEP_TICKS = 8;
export const REFERENCE_PACE_PER_TICK: Fixed = fx.div(HALF_COLUMN, fx.fromInt(REFERENCE_STEP_TICKS));

/** The pre-existing fallback for an animal whose row explicitly sets `movespeed` to 0. Rows that omit
 *  `movespeed` receive the content default of 8 before reaching this system. */
const DEFAULT_ANIMAL_TICKS_PER_CELL = 18;
const DEFAULT_ANIMAL_PACE_PER_TICK: Fixed = fx.divCeil(ONE, fx.fromInt(DEFAULT_ANIMAL_TICKS_PER_CELL));

/** Baseline obstruction pace for an unencumbered adult. Obstruction scales this down for a longer
 *  captured leg cost and excludes held turn ticks. */
export const SLOWEST_PACE_PER_TICK: Fixed = fx.div(HALF_ROW, fx.fromInt(MAX_STEP_TICKS));

/** The current walker's leg, measured once per tick and shared by its distance check and its step. */
const leg = emptyLegMeasure();
/** The step modifiers of the leg being laid out or paced, read and consumed before the next walker's. */
const stepModifiers = emptyWalkStepModifiers();

/**
 * Advances every {@link PathFollow} walker one tick; dropping the path at the last waypoint is what the
 * planner reads as arrived.
 *
 * A human walks each leg in its step cost (`walkStepTicks`) plus held turn ticks: the cost is fixed when the leg starts
 * from the resistance of the node it leaves and the walker's state then, the position closes the remaining
 * distance in equal shares of the movement ticks left, and the last tick lands on the stop. Turning
 * holds progress for all but its final tick; no acceleration or braking is modelled. A creature with
 * {@link MoveStepPeriod} takes its content-defined ticks per waypoint; an explicit {@link MoveSpeed}
 * advances a fixed world distance each tick.
 */
export const movementSystem: System = (world, ctx) => {
  // An interrupted run can lose its route before this pass; shed the visual gait while it stands.
  for (const e of world.query(AnimalRunning)) {
    if (!world.has(e, PathFollow)) world.remove(e, AnimalRunning);
  }
  const countTraffic = trafficCounter(world, ctx);
  // Each walker steps this point and writes Position back only when it moved, so a held turn or a
  // finished route does not log a write.
  const p = { x: ZERO, y: ZERO };
  const write: FollowWrite = { follow: undefined };
  for (const e of world.query(Position, PathFollow)) {
    write.follow = undefined;
    const pf = world.get(e, PathFollow);
    const stops = world.get(e, PathRoute).waypoints;
    const stored = world.get(e, Position);
    // Read with the other components so its fetch overlaps theirs; a leg start re-reads it after turning.
    const facing = world.tryGet(e, WalkFacing);
    p.x = stored.x;
    p.y = stored.y;
    // Whether the walker stands on its stop, read this early so the stop's fetch overlaps the reads
    // below. A human's leg is the one reader and runs once, on the first pass, before anything moves p.
    const first = stops[pf.index];
    const onFirstStop = first !== undefined && first.x === p.x && first.y === p.y;
    const wild = isWildlife(world, e);
    if (wild) syncAnimalGait(world, ctx, e, pf);
    // Wildlife with source `movespeed = 0` has no period component, but stays on the animal fallback
    // rather than inheriting human terrain, fatigue, equipment and hunger rules.
    const period = world.tryGet(e, MoveStepPeriod)?.ticks;
    const paced = period === undefined && (wild || world.has(e, MoveSpeed));
    let budget = paced ? creaturePace(world, e) : ULP;
    while (true) {
      const target = stops[pf.index];
      if (target === undefined) {
        dropPath(world, e);
        world.remove(e, AnimalRunning);
        break;
      }
      const distance = paced ? measureLeg(p, target, leg) : ULP;
      const arrived = paced
        ? stepAlongLeg(p, target, leg, budget)
        : period === undefined
          ? walkHumanLeg(world, ctx, e, pf, write, stops, p, target, facing, onFirstStop)
          : walkPeriodicLeg(world, ctx, e, pf, write, stops, p, target, period);
      if (p.x !== stored.x || p.y !== stored.y) {
        const moved = world.mut(e, Position);
        moved.x = p.x;
        moved.y = p.y;
      }
      if (!arrived) break;
      const from = stops[pf.index - 1];
      if (countTraffic !== null && !paced && period === undefined && from !== undefined) {
        countTraffic(e, from.node, target.node);
      }
      if (pf.index + 1 >= stops.length) {
        if (!paced && period === undefined) {
          chargeNode(
            world,
            ctx,
            e,
            resistanceAt(ctx.terrain, target),
            hasLiveBoots(world, e),
            isCarryingGood(world, e),
          );
        }
        dropPath(world, e);
        world.remove(e, AnimalRunning);
        break;
      }
      const next = writableFollow(world, e, write);
      next.index += 1;
      next.legElapsed = 0;
      next.legStartedAt = undefined;
      next.legCost = 0;
      next.legPace = undefined;
      next.departureCharged = undefined;
      if (!paced) break;
      // A creature spends the unused portion of this tick's pace on its next leg. Dropping that
      // remainder at every waypoint made short edges and frequent reroutes slow it down.
      budget = fx.sub(budget, distance);
      if (budget <= 0) break;
    }
  }
};

/** Change a wild animal's gait at a waypoint boundary, where no leg's captured cost is in flight.
 *  Approximation: the original changes the step rate as soon as an attack or flee task starts, mid-leg
 *  included. */
function syncAnimalGait(
  world: World,
  ctx: SystemContext,
  e: Entity,
  follow: { readonly legCost: number },
): void {
  if (follow.legCost !== 0) return;
  const tribe = world.get(e, Settler).tribe;
  const locomotion = locomotionOf(ctx.content, tribe);
  if (locomotion === null) return;
  const running =
    locomotion.runSpeed > 0 &&
    locomotion.runSpeed !== locomotion.walkSpeed &&
    (world.has(e, Frightened) || world.has(e, Engagement));
  const period = running ? locomotion.runSpeed : locomotion.walkSpeed;
  const current = world.tryGet(e, MoveStepPeriod)?.ticks;
  if (period > 0 && current !== period) world.add(e, MoveStepPeriod, { ticks: period });
  else if (period <= 0 && current !== undefined) world.remove(e, MoveStepPeriod);
  if (running && !world.has(e, AnimalRunning)) world.add(e, AnimalRunning, {});
  else if (!running && world.has(e, AnimalRunning)) world.remove(e, AnimalRunning);
}

type FollowState = NonNullable<(typeof PathFollow)['__value']>;
type WalkFacingState = NonNullable<(typeof WalkFacing)['__value']>;

/** A walker's {@link PathFollow} write handle for the tick, acquired at its first change, so the tick's
 *  field updates log one write. */
interface FollowWrite {
  follow: FollowState | undefined;
}

function writableFollow(world: World, e: Entity, write: FollowWrite): FollowState {
  write.follow ??= world.mut(e, PathFollow);
  return write.follow;
}

/** The per-node charge: after pace is read at departure, and once at the terminal destination.
 *  Original behavior: pace updates before shoe/food points are spent, and the charge lands before a
 *  new step and when the destination is reached; a pressing need then reaches for a carried draught. */
function chargeNode(
  world: World,
  ctx: SystemContext,
  e: Entity,
  resistance: number,
  shoes: boolean,
  carrying: boolean,
): void {
  if (shoes) wearWornBoots(world, ctx, e, resistance, carrying);
  else chargeBarefootStep(world, ctx, e, resistance, carrying);
  drinkPressingDraughts(world, ctx, e);
}

function resistanceAt(terrain: TerrainGraph | undefined, waypoint: { node: NodeId } | undefined): number {
  return terrain === undefined || waypoint === undefined
    ? DEFAULT_NODE_ROUGHNESS
    : terrain.resistanceAt(waypoint.node);
}

/** The resistance of the node the current leg leaves, a road's included, which paces and shoes it: the
 *  previous stop, or on a route's first leg the stop itself (the walker stands beside it). A mapless sim
 *  walks the default. */
function departureResistance(
  terrain: TerrainGraph | undefined,
  pf: Readonly<FollowState>,
  stops: readonly Waypoint[],
): number {
  const from = stops[pf.index > 0 ? pf.index - 1 : 0];
  return resistanceAt(terrain, from);
}

/** One tick of a human's leg; true once it stands on `target`. */
function walkHumanLeg(
  world: World,
  ctx: SystemContext,
  e: Entity,
  pf: Readonly<FollowState>,
  write: FollowWrite,
  stops: readonly Waypoint[],
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  facing: Readonly<WalkFacingState> | undefined,
  onTarget: boolean,
): boolean {
  // A redirect onto the current centre (`onTarget`: p is on `target`) ends even a held turn without
  // inventing another heading.
  if (onTarget) return true;
  let turn = facing;
  if (pf.legCost === 0) {
    const resistance = departureResistance(ctx.terrain, pf, stops);
    const follow = writableFollow(world, e, write);
    const modifiers = walkStepModifiersOf(world, e, ctx.content, ctx.tick, stepModifiers);
    beginTimedLeg(follow, stops, p, target, walkStepTicks(resistance, modifiers));
    // The planned heading is fixed for this leg. Separation can nudge the position across an octant
    // boundary; re-aiming every tick would insert fresh turn holds in the middle of a steady step.
    // The departure charge below spends boots and needs only, so the facing read here still holds.
    turn = beginWalkTurn(world, e, pf.legPace === undefined ? (stops[pf.index - 1] ?? p) : p, target);
    if (pf.departureCharged !== true) {
      // Laying the leg and the turn out writes neither boots nor load, so the modifiers still hold.
      chargeNode(world, ctx, e, resistance, modifiers.shoes, modifiers.carrying);
      follow.departureCharged = true;
    }
  }
  // Rotate before the first advancing tick as well as later ones. Moving once and only then holding
  // for the rest of a turn made rapid redirects visibly jerk and left the first step facing sideways.
  if (!finishWalkTurn(world, e, turn)) {
    if (pf.legStartedAt !== undefined) {
      const held = writableFollow(world, e, write);
      held.legElapsed = pathLegTicks(pf, ctx.tick - 1);
      held.legStartedAt = undefined;
    }
    return false;
  }
  return advanceTimedLeg(world, ctx, e, pf, write, p, target, MAX_STEP_PER_TICK);
}

function walkPeriodicLeg(
  world: World,
  ctx: SystemContext,
  e: Entity,
  pf: Readonly<FollowState>,
  write: FollowWrite,
  stops: readonly Waypoint[],
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  period: number,
): boolean {
  if (pf.legCost === 0) {
    if (p.x === target.x && p.y === target.y) return true;
    beginTimedLeg(writableFollow(world, e, write), stops, p, target, period);
  }
  return advanceTimedLeg(world, ctx, e, pf, write, p, target);
}

function beginTimedLeg(
  pf: FollowState,
  stops: readonly Waypoint[],
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  fullCost: number,
): void {
  pf.legCost = fullCost;
  const plannedFrom = stops[pf.index - 1];
  if (plannedFrom === undefined || (plannedFrom.x === p.x && plannedFrom.y === p.y)) return;
  const plannedDistance = worldDistance(plannedFrom.x, plannedFrom.y, target.x, target.y);
  if (plannedDistance <= 0) return;
  // Route splices retain the ordinary whole-step pace even when their first leg is a fraction of an
  // edge or extends past one. The partial leg can therefore end before or after its nominal period.
  pf.legPace = fx.divCeil(plannedDistance, fx.fromInt(fullCost));
}

function advanceTimedLeg(
  world: World,
  ctx: SystemContext,
  e: Entity,
  pf: Readonly<FollowState>,
  write: FollowWrite,
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  maxPerTick?: Fixed,
): boolean {
  if (pf.legStartedAt === undefined) {
    writableFollow(world, e, write).legStartedAt = ctx.tick - 1 - pf.legElapsed;
  }
  if (pf.legPace !== undefined) {
    return stepTowardPoint(
      p,
      target,
      maxPerTick !== undefined && pf.legPace > maxPerTick ? maxPerTick : pf.legPace,
    );
  }
  const remaining = pf.legCost - pathLegTicks(pf, ctx.tick);
  const dist = measureLeg(p, target, leg);
  // The equal share of what is left; on the last tick the whole of it, so the walker lands exactly. A
  // push can leave more than the cap to cover, which then delays the arrival but never prevents it.
  const share = remaining > 0 ? fx.div(dist, fx.fromInt(remaining + 1)) : dist;
  return stepAlongLeg(p, target, leg, maxPerTick !== undefined && share > maxPerTick ? maxPerTick : share);
}

/** How far `e` advances along its route each tick, or null while it stands. A timed walker between legs is
 *  read at the pace its next leg will start with. */
export function walkPacePerTick(world: World, ctx: SystemContext, e: Entity): Fixed | null {
  const pf = world.tryGet(e, PathFollow);
  const stops = world.tryGet(e, PathRoute)?.waypoints;
  if (pf === undefined || stops === undefined) return null;
  const period = world.tryGet(e, MoveStepPeriod)?.ticks;
  if (period === undefined && (world.has(e, MoveSpeed) || isWildlife(world, e)))
    return creaturePace(world, e);
  if (pf.legPace !== undefined) return pf.legPace;
  const to = stops[pf.index];
  if (to === undefined) return null;
  const from = pf.legCost === 0 ? world.get(e, Position) : stops[pf.index - 1];
  if (from === undefined) return null;
  const ticks =
    pf.legCost !== 0
      ? pf.legCost
      : (period ??
        walkStepTicks(
          departureResistance(ctx.terrain, pf, stops),
          walkStepModifiersOf(world, e, ctx.content, ctx.tick, stepModifiers),
        ));
  return fx.div(worldDistance(from.x, from.y, to.x, to.y), fx.fromInt(ticks));
}

/** A creature's constant pace; a content pace that truncates to 0 ulps never makes progress, so one ULP
 *  keeps such a pace terminating. */
function creaturePace(world: World, e: Entity): Fixed {
  const pace = world.tryGet(e, MoveSpeed)?.perTick ?? DEFAULT_ANIMAL_PACE_PER_TICK;
  return pace > ULP ? pace : ULP;
}
