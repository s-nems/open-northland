import { isWildlife, MoveSpeed, PathFollow, Position, Velocity } from '../../components/index.js';
import { type Fixed, fx, ONE, ULP } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { DEFAULT_NODE_ROUGHNESS, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { HALF_COLUMN, HALF_ROW, worldDistance } from '../../nav/world-metric.js';
import type { System, SystemContext } from '../context.js';
import { wearWornBoots } from '../equipment/index.js';
import { chargeBarefootStep } from '../lifecycle/needs/index.js';
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

/** The pre-existing fallback for an animal whose source `movespeed` is 0 (the engine default is not
 *  decoded). It remains independent of the human terrain/shoes cost until that animal default is pinned. */
const DEFAULT_ANIMAL_TICKS_PER_CELL = 18;
const DEFAULT_ANIMAL_PACE_PER_TICK: Fixed = fx.divCeil(ONE, fx.fromInt(DEFAULT_ANIMAL_TICKS_PER_CELL));

/** Baseline obstruction pace for an unencumbered adult. Obstruction scales this down for a longer
 *  captured leg cost and excludes held turn ticks. */
export const SLOWEST_PACE_PER_TICK: Fixed = fx.div(HALF_ROW, fx.fromInt(MAX_STEP_TICKS));

/**
 * Advances entity positions one tick. A {@link PathFollow} takes precedence over any {@link Velocity}, and
 * dropping it at the last waypoint is what the planner reads as arrived.
 *
 * A human walks each leg in its step cost (`walkStepTicks`) plus held turn ticks: the cost is fixed when the leg starts
 * from the roughness of the node it leaves and the walker's state then, the position closes the remaining
 * distance in equal shares of the movement ticks left, and the last tick lands on the stop. Turning
 * holds progress for all but its final tick; no acceleration or braking is modelled. A creature keeps its
 * content-paced constant {@link MoveSpeed}.
 */
export const movementSystem: System = (world, ctx) => {
  // A path can complete within this pass, so the velocity pass below cannot re-derive membership from
  // has(PathFollow) and must read the recorded set instead.
  const pathHandled = new Set<Entity>();

  for (const e of world.query(Position, PathFollow)) {
    pathHandled.add(e);
    const pf = world.mut(e, PathFollow);
    const target = pf.waypoints[pf.index];
    if (target === undefined) {
      world.remove(e, PathFollow);
      continue;
    }
    const p = world.mut(e, Position);
    // Wildlife with source `movespeed = 0` has no MoveSpeed component, but it must stay on the animal
    // fallback rather than inheriting human terrain, fatigue, equipment and hunger rules.
    const paced = world.has(e, MoveSpeed) || isWildlife(world, e);
    const arrived = paced
      ? stepTowardPoint(p, target, creaturePace(world, e))
      : walkHumanLeg(world, ctx, e, pf, p, target);
    if (!arrived) continue;
    if (pf.index + 1 >= pf.waypoints.length) {
      if (!paced) chargeNode(world, ctx, e, roughnessAt(ctx.terrain, target));
      world.remove(e, PathFollow);
    } else {
      pf.index += 1;
      pf.legTicks = 0;
      pf.legCost = 0;
    }
  }

  for (const e of world.query(Position, Velocity)) {
    if (pathHandled.has(e)) continue;
    const p = world.mut(e, Position);
    const v = world.get(e, Velocity);
    p.x = fx.add(p.x, v.x);
    p.y = fx.add(p.y, v.y);
  }
};

type FollowState = NonNullable<(typeof PathFollow)['__value']>;

/** Original node callback: after pace is read at departure, and once at the terminal destination.
 *  The original updates pace before spending shoe/food points, and runs the callback before a new step
 *  and when the destination is reached. */
function chargeNode(world: World, ctx: SystemContext, e: Entity, roughness: number): void {
  const carrying = isCarryingGood(world, e);
  if (hasLiveBoots(world, e)) wearWornBoots(world, ctx, e, roughness, carrying);
  else chargeBarefootStep(world, ctx, e, roughness, carrying);
}

function roughnessAt(terrain: TerrainGraph | undefined, waypoint: { node: NodeId } | undefined): number {
  return terrain === undefined || waypoint === undefined
    ? DEFAULT_NODE_ROUGHNESS
    : terrain.roughnessAt(waypoint.node);
}

/** The roughness of the node the current leg leaves, which paces and shoes it: the previous stop, or on
 *  a route's first leg the stop itself (the walker stands beside it). A mapless sim walks the default. */
function departureRoughness(terrain: TerrainGraph | undefined, pf: FollowState): number {
  const from = pf.waypoints[pf.index > 0 ? pf.index - 1 : 0];
  return roughnessAt(terrain, from);
}

/** One tick of a human's leg; true once it stands on `target`. */
function walkHumanLeg(
  world: World,
  ctx: SystemContext,
  e: Entity,
  pf: FollowState,
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
): boolean {
  if (pf.legCost === 0) {
    // A same-node request has only its destination callback, not an extra departure.
    if (p.x === target.x && p.y === target.y) return true;
    const roughness = departureRoughness(ctx.terrain, pf);
    pf.legCost = walkStepTicks(roughness, walkStepModifiersOf(world, e, ctx.content));
    // Use the planned edge: collision separation can push the actual position off its axis.
    beginWalkTurn(world, e, pf.waypoints[pf.index - 1] ?? p, target);
    chargeNode(world, ctx, e, roughness);
  } else if (!finishWalkTurn(world, e)) return false;
  pf.legTicks += 1;
  const remaining = pf.legCost - pf.legTicks;
  const dist = worldDistance(p.x, p.y, target.x, target.y);
  // The equal share of what is left; on the last tick the whole of it, so the walker lands exactly. A
  // push can leave more than the cap to cover, which then delays the arrival but never prevents it.
  const share = remaining > 0 ? fx.div(dist, fx.fromInt(remaining + 1)) : dist;
  return stepTowardPoint(p, target, share < MAX_STEP_PER_TICK ? share : MAX_STEP_PER_TICK);
}

/** A creature's constant pace; a content pace that truncates to 0 ulps never makes progress, so one ULP
 *  keeps such a pace terminating. */
function creaturePace(world: World, e: Entity): Fixed {
  const pace = world.tryGet(e, MoveSpeed)?.perTick ?? DEFAULT_ANIMAL_PACE_PER_TICK;
  return pace > ULP ? pace : ULP;
}
