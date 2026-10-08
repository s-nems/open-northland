import {
  ClaimAnimalOrder,
  CurrentAtomic,
  Owner,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { claimableBy, LIVESTOCK_CAPTURE_RANGE } from '../livestock/capture.js';
import { isTravelling, redirectRoute, stopAtNextNode } from '../movement/nav-state.js';
import { isScoutJob } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';
import { deferOrderDuringAtomic, isOrderableSettler } from './guards.js';
import { moveUnit, reachableMoveGoal } from './movement.js';

/** How often a scout's walk may be re-aimed at the animal it follows, in ticks. Approximation, tuned so a
 *  grazing animal's steps re-route about once a second rather than every tick. */
export const CLAIM_RETARGET_TICKS = TICKS_PER_SECOND;

/** Whether `scout` may go after `animal`: an owned scout with a position, and an animal its player may
 *  claim. Signposts never confine a scout, so the walk needs no navigation-limit check of its own. */
function canClaim(world: World, ctx: SystemContext, scout: Entity, animal: Entity): boolean {
  if (!world.isAlive(animal) || !world.has(animal, Position)) return false;
  if (!world.has(scout, Position) || !isScoutJob(ctx.content, world.get(scout, Settler).jobType))
    return false;
  return claimableBy(world, animal, world.get(scout, Owner).player);
}

/** The node a walk after `animal` heads for: the animal's own node, snapped to one the scout can stand on. */
function animalGoal(world: World, ctx: SystemContext, terrain: TerrainGraph, animal: Entity): NodeId {
  return reachableMoveGoal(world, ctx, terrain, entityNode(world, terrain, animal));
}

function nodeHexDistance(terrain: TerrainGraph, a: NodeId, b: NodeId): number {
  return hexDistanceBetween(terrain.xOf(a), terrain.yOf(a), terrain.xOf(b), terrain.yOf(b));
}

/**
 * Order one owned scout after `animal` - see the command doc. Runs as a normal {@link moveUnit} walk to the
 * animal carrying a {@link ClaimAnimalOrder}, which {@link claimAnimalOrderSystem} keeps aimed at the animal
 * until the capture pass claims it. Returns whether the order was taken.
 */
export function orderClaimAnimal(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'claimAnimal' }>,
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return false; // mapless sim: no cells to walk
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !canClaim(world, ctx, e, command.animal)) return false;
  // A non-interruptible atomic parks the whole command, as an inner moveUnit alone would strand the marker.
  if (deferOrderDuringAtomic(world, ctx, e, command)) return true;
  const goal = animalGoal(world, ctx, terrain, command.animal);
  const c = terrain.coordsOf(goal);
  if (!moveUnit(world, ctx, { kind: 'moveUnit', entity: e, x: c.x, y: c.y })) return false;
  world.add(e, ClaimAnimalOrder, {
    animal: command.animal,
    goal,
    retargetAt: ctx.tick + CLAIM_RETARGET_TICKS,
  });
  return true;
}

/**
 * Keep each scout's {@link ClaimAnimalOrder} walking after its animal. Runs just before the player-order
 * system, so an arrival short of a moved animal is re-aimed before that system would retire the walk, and a
 * failed or interrupted walk is seen while its traces stand. A claimed animal ends the order and the walk.
 *
 * Determinism: each order reads only its own scout and animal, so visit order cannot change the result.
 */
export const claimAnimalOrderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  // Collected first: dropping the marker edits the store under the query.
  for (const e of [...world.query(Settler, ClaimAnimalOrder)]) {
    const order = world.get(e, ClaimAnimalOrder);
    const walk = world.tryGet(e, PlayerOrder);
    if (!world.has(e, Owner) || !canClaim(world, ctx, e, order.animal)) {
      // Claimed, gone, or out of this scout's reach to claim: the walk after it ends where the scout is, and
      // a load being set down stays down.
      world.remove(e, ClaimAnimalOrder);
      if (walk !== undefined) {
        world.remove(e, PlayerOrder);
        stopAtNextNode(world, terrain, e);
      }
      continue;
    }
    // The walk was taken over or hunger suspended it: the order goes with it.
    if (walk === undefined) {
      world.remove(e, ClaimAnimalOrder);
      continue;
    }
    if (walk.pendingGoal !== undefined) continue; // still setting a load down
    // A need took the scout, or the route failed: the player-order system ends the walk, the order goes.
    if (world.has(e, CurrentAtomic) || world.tryGet(e, PathRequest)?.failed === true) {
      world.remove(e, ClaimAnimalOrder);
      continue;
    }
    const arrived = !isTravelling(world, e);
    if (!arrived && ctx.tick < order.retargetAt) continue;
    const goal = animalGoal(world, ctx, terrain, order.animal);
    if (arrived) {
      // Standing in claim reach of the animal's node, the capture pass has had its go: nothing nearer to walk.
      if (nodeHexDistance(terrain, entityNode(world, terrain, e), goal) <= LIVESTOCK_CAPTURE_RANGE) {
        world.remove(e, ClaimAnimalOrder);
        continue;
      }
    } else if (nodeHexDistance(terrain, goal, order.goal) <= LIVESTOCK_CAPTURE_RANGE) {
      continue; // the walk still ends in reach of the animal
    }
    redirectRoute(world, e, goal);
    const held = world.mut(e, ClaimAnimalOrder);
    held.goal = goal;
    held.retargetAt = ctx.tick + CLAIM_RETARGET_TICKS;
  }
};
