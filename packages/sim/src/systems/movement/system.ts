import {
  isWildlife,
  MoveSpeed,
  MoveStepPeriod,
  PathFollow,
  PathRoute,
  Position,
  type Waypoint,
} from '../../components/index.js';
import { type Fixed, fx, ONE, ULP } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { DEFAULT_NODE_ROUGHNESS, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { HALF_COLUMN, HALF_ROW, worldDistance } from '../../nav/world-metric.js';
import type { System, SystemContext } from '../context.js';
import { wearWornBoots } from '../equipment/index.js';
import { chargeBarefootStep, drinkPressingDraughts } from '../lifecycle/needs/index.js';
import { dropPath } from './nav-state.js';
import { stepTowardPoint } from './stepping.js';
import { beginWalkTurn, finishWalkTurn } from './turning.js';
import {
  hasLiveBoots,
  isCarryingGood,
  MAX_STEP_TICKS,
  MIN_STEP_TICKS,
  walkStepModifiersOf,
  walkStepTicks,
} from './walk-cost.js';

/**
 * The most a human advances in one tick, in world-metric column units: the E/W half-column step, the
 * longest lattice edge a single step covers, over the engine's floor on a step cost. A leg paced under it
 * never touches it, so it only bounds the catch-up after a separation push, keeping the unit-separation
 * impassability bound (`collision/separation.ts`) below the body radius.
 */
export const MAX_STEP_PER_TICK: Fixed = fx.div(HALF_COLUMN, fx.fromInt(MIN_STEP_TICKS));

/**
 * The reference human pace the separation approximations scale their caps by: a rested, barefoot,
 * unladen walker crossing land (roughness 2), 8 ticks a half-column step.
 */
export const REFERENCE_STEP_TICKS = 8;
export const REFERENCE_PACE_PER_TICK: Fixed = fx.div(HALF_COLUMN, fx.fromInt(REFERENCE_STEP_TICKS));

/** The pre-existing fallback for an animal whose source `movespeed` is 0 (the original's default is
 *  unknown). It remains independent of the human terrain/shoes cost until that animal default is pinned. */
const DEFAULT_ANIMAL_TICKS_PER_CELL = 18;
const DEFAULT_ANIMAL_PACE_PER_TICK: Fixed = fx.divCeil(ONE, fx.fromInt(DEFAULT_ANIMAL_TICKS_PER_CELL));

/** Baseline obstruction pace for an unencumbered adult. Obstruction scales this down for a longer
 *  captured leg cost and excludes held turn ticks. */
export const SLOWEST_PACE_PER_TICK: Fixed = fx.div(HALF_ROW, fx.fromInt(MAX_STEP_TICKS));

/**
 * Advances every {@link PathFollow} walker one tick; dropping the path at the last waypoint is what the
 * planner reads as arrived.
 *
 * A human walks each leg in its step cost (`walkStepTicks`) plus held turn ticks: the cost is fixed when the leg starts
 * from the roughness of the node it leaves and the walker's state then, the position closes the remaining
 * distance in equal shares of the movement ticks left, and the last tick lands on the stop. Turning
 * holds progress for all but its final tick; no acceleration or braking is modelled. A creature with
 * {@link MoveStepPeriod} takes its content-defined ticks per waypoint; an explicit {@link MoveSpeed}
 * advances a fixed world distance each tick.
 */
export const movementSystem: System = (world, ctx) => {
  for (const e of world.query(Position, PathFollow)) {
    const pf = world.mut(e, PathFollow);
    const stops = world.get(e, PathRoute).waypoints;
    const p = world.mut(e, Position);
    // Wildlife with source `movespeed = 0` has no period component, but stays on the animal fallback
    // rather than inheriting human terrain, fatigue, equipment and hunger rules.
    const period = world.tryGet(e, MoveStepPeriod)?.ticks;
    const paced = period === undefined && (world.has(e, MoveSpeed) || isWildlife(world, e));
    let budget = paced ? creaturePace(world, e) : ULP;
    while (true) {
      const target = stops[pf.index];
      if (target === undefined) {
        dropPath(world, e);
        break;
      }
      const distance = paced ? worldDistance(p.x, p.y, target.x, target.y) : ULP;
      const arrived = paced
        ? stepTowardPoint(p, target, budget)
        : period === undefined
          ? walkHumanLeg(world, ctx, e, pf, stops, p, target)
          : walkPeriodicLeg(pf, stops, p, target, period);
      if (!arrived) break;
      if (pf.index + 1 >= stops.length) {
        if (!paced && period === undefined) chargeNode(world, ctx, e, roughnessAt(ctx.terrain, target));
        dropPath(world, e);
        break;
      }
      pf.index += 1;
      pf.legTicks = 0;
      pf.legCost = 0;
      pf.legPace = undefined;
      pf.departureCharged = undefined;
      if (!paced) break;
      // A creature spends the unused portion of this tick's pace on its next leg. Dropping that
      // remainder at every waypoint made short edges and frequent reroutes slow it down.
      budget = fx.sub(budget, distance);
      if (budget <= 0) break;
    }
  }
};

type FollowState = NonNullable<(typeof PathFollow)['__value']>;

/** The per-node charge: after pace is read at departure, and once at the terminal destination.
 *  Original behavior: pace updates before shoe/food points are spent, and the charge lands before a
 *  new step and when the destination is reached; a pressing need then reaches for a carried draught. */
function chargeNode(world: World, ctx: SystemContext, e: Entity, roughness: number): void {
  const carrying = isCarryingGood(world, e);
  if (hasLiveBoots(world, e)) wearWornBoots(world, ctx, e, roughness, carrying);
  else chargeBarefootStep(world, ctx, e, roughness, carrying);
  drinkPressingDraughts(world, ctx, e);
}

function roughnessAt(terrain: TerrainGraph | undefined, waypoint: { node: NodeId } | undefined): number {
  return terrain === undefined || waypoint === undefined
    ? DEFAULT_NODE_ROUGHNESS
    : terrain.roughnessAt(waypoint.node);
}

/** The roughness of the node the current leg leaves, which paces and shoes it: the previous stop, or on
 *  a route's first leg the stop itself (the walker stands beside it). A mapless sim walks the default. */
function departureRoughness(
  terrain: TerrainGraph | undefined,
  pf: FollowState,
  stops: readonly Waypoint[],
): number {
  const from = stops[pf.index > 0 ? pf.index - 1 : 0];
  return roughnessAt(terrain, from);
}

/** One tick of a human's leg; true once it stands on `target`. */
function walkHumanLeg(
  world: World,
  ctx: SystemContext,
  e: Entity,
  pf: FollowState,
  stops: readonly Waypoint[],
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
): boolean {
  // A redirect onto the current centre ends even a held turn without inventing another heading.
  if (p.x === target.x && p.y === target.y) return true;
  if (pf.legCost === 0) {
    const roughness = departureRoughness(ctx.terrain, pf, stops);
    beginTimedLeg(pf, stops, p, target, walkStepTicks(roughness, walkStepModifiersOf(world, e, ctx.content)));
    // The planned heading is fixed for this leg. Separation can nudge the position across an octant
    // boundary; re-aiming every tick would insert fresh turn holds in the middle of a steady step.
    beginWalkTurn(world, e, pf.legPace === undefined ? (stops[pf.index - 1] ?? p) : p, target);
    if (pf.departureCharged !== true) {
      chargeNode(world, ctx, e, roughness);
      pf.departureCharged = true;
    }
  }
  // Rotate before the first advancing tick as well as later ones. Moving once and only then holding
  // for the rest of a turn made rapid redirects visibly jerk and left the first step facing sideways.
  if (!finishWalkTurn(world, e)) return false;
  return advanceTimedLeg(pf, p, target, MAX_STEP_PER_TICK);
}

function walkPeriodicLeg(
  pf: FollowState,
  stops: readonly Waypoint[],
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  period: number,
): boolean {
  if (pf.legCost === 0) {
    if (p.x === target.x && p.y === target.y) return true;
    beginTimedLeg(pf, stops, p, target, period);
  }
  return advanceTimedLeg(pf, p, target);
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
  pf: FollowState,
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  maxPerTick?: Fixed,
): boolean {
  pf.legTicks += 1;
  if (pf.legPace !== undefined) {
    return stepTowardPoint(
      p,
      target,
      maxPerTick !== undefined && pf.legPace > maxPerTick ? maxPerTick : pf.legPace,
    );
  }
  const remaining = pf.legCost - pf.legTicks;
  const dist = worldDistance(p.x, p.y, target.x, target.y);
  // The equal share of what is left; on the last tick the whole of it, so the walker lands exactly. A
  // push can leave more than the cap to cover, which then delays the arrival but never prevents it.
  const share = remaining > 0 ? fx.div(dist, fx.fromInt(remaining + 1)) : dist;
  return stepTowardPoint(p, target, maxPerTick !== undefined && share > maxPerTick ? maxPerTick : share);
}

/** A creature's constant pace; a content pace that truncates to 0 ulps never makes progress, so one ULP
 *  keeps such a pace terminating. */
function creaturePace(world: World, e: Entity): Fixed {
  const pace = world.tryGet(e, MoveSpeed)?.perTick ?? DEFAULT_ANIMAL_PACE_PER_TICK;
  return pace > ULP ? pace : ULP;
}
