import {
  Engagement,
  Frightened,
  Owner,
  PathRequest,
  Position,
  Resting,
  Settler,
  StayPoint,
  WildHabitat,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { herdLeaderOf } from '../movement/herd-leader.js';
import { herdRoster } from '../movement/herd-roster.js';
import { clearNavState, isTravelling, redirectRoute } from '../movement/nav-state.js';
import { settlerMovementNode, settlerTraversal } from '../movement/traversal.js';
import { fleeCandidates, fleeDestination } from './flee.js';

// An animal's flight from a blow. Original behavior: a struck herd leader that does not turn on its attacker
// runs once, at run speed, to the point farthest from the attacker within 20 map points, and its followers
// run after it rather than each picking a flight of their own. The flight ends where it arrives, and a wild
// herd settles there: the flight's goal becomes the leader's stay point and work center.

/** How far (map points) a fleeing leader runs from its attacker. Original behavior. Approximation: the
 *  candidates are the eight compass directions, each at the farthest point within that reach a route can
 *  end on, rather than every point within it. */
export const FLIGHT_REACH_NODES = 20;

/**
 * Run every {@link Frightened} animal. A leader aims its one flight on its first tick, and calms once it has
 * arrived, its route was refused, or no point gains it distance. A follower walks to its leader's
 * destination and calms with its leader. A fleeing leader's followers take fright from the next tick,
 * however far they stand. A scattering animal aims a point of its own, so stock standing together fans out.
 */
export const animalFrightSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless fixture world - nowhere to run
  let blocked: BlockOverlay | undefined;
  const fleeing: Entity[] = [];
  const frighteneds = world.canonicalQuery(Frightened, Settler, Position);
  for (let i = 0; i < frighteneds.length; i++) {
    const e = frighteneds[i] as Entity;
    // Indoors (a farm's feed batch owns it) an animal runs nowhere: routing it would walk the body out.
    if (world.has(e, Resting)) continue;
    const f = world.get(e, Frightened);
    const leader = herdLeaderOf(world, e);
    if (leader !== e) {
      const flight = world.tryGet(leader, Frightened);
      if (flight === undefined) {
        calm(world, e);
        continue;
      }
      if (world.tryGet(e, PathRequest)?.failed) clearNavState(world, e);
      else if (flight.dest !== null && f.dest !== flight.dest) {
        redirectRoute(world, e, flight.dest);
        world.mut(e, Frightened).dest = flight.dest;
      }
      continue;
    }
    if (f.dest !== null) {
      if (world.tryGet(e, PathRequest)?.failed || !isTravelling(world, e)) calm(world, e);
      else fleeing.push(e);
      continue;
    }
    const here = settlerMovementNode(world, terrain, e);
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    const overlay = blocked;
    const traversal = settlerTraversal(world, e);
    const bank = terrain.componentOf(here);
    const routeEnd = (cell: NodeId): boolean =>
      terrain.traversable(cell, traversal) &&
      !overlay.has(cell) &&
      (bank < 0 || terrain.componentOf(cell) === bank);
    const dest =
      f.scatter === true
        ? scatterPoint(
            fleeCandidates(terrain, overlay, here, [f.from], FLIGHT_REACH_NODES, routeEnd, traversal),
            e,
          )
        : fleeDestination(terrain, overlay, here, [f.from], FLIGHT_REACH_NODES, routeEnd, traversal);
    if (dest === undefined || dest === here) {
      calm(world, e); // boxed in: no walkable point gains distance from the attacker
      continue;
    }
    redirectRoute(world, e, dest);
    world.mut(e, Frightened).dest = dest;
    settleWhereFled(world, e, dest);
    fleeing.push(e);
  }
  if (fleeing.length > 0) alarmFollowers(world, fleeing);
};

/** How many of the best flight points a scattering animal picks among, by its id, so a herd standing
 *  together fans out instead of running one way. Our addition, tuned by eye. */
const SCATTER_FAN = 3;

/** A scattering animal's flight point: one of the {@link SCATTER_FAN} best `candidates`, by `e`'s id. */
function scatterPoint(candidates: readonly NodeId[], e: Entity): NodeId | undefined {
  if (candidates.length === 0) return undefined;
  return candidates[e % Math.min(SCATTER_FAN, candidates.length)];
}

/** Original behavior: a wild leader's flight goal becomes its stay point and work center, so its herd
 *  settles where it fled. */
function settleWhereFled(world: World, leader: Entity, dest: NodeId): void {
  const habitat = world.tryGet(leader, WildHabitat);
  if (habitat === undefined || world.has(leader, Owner)) return;
  if (habitat.workCenter !== dest) world.mut(leader, WildHabitat).workCenter = dest;
  const stay = world.tryGet(leader, StayPoint);
  if (stay !== undefined && stay.cell !== dest) world.mut(leader, StayPoint).cell = dest;
}

/** Original behavior: the followers of a fleeing leader run after it, letting go of any target they hold. */
function alarmFollowers(world: World, leaders: readonly Entity[]): void {
  const roster = herdRoster(world);
  for (const leader of leaders) {
    const from = world.get(leader, Frightened).from;
    for (const m of roster.membersOf(leader)) {
      if (m === leader || world.has(m, Frightened) || world.has(m, Resting)) continue;
      world.remove(m, Engagement);
      world.add(m, Frightened, { from, dest: null });
    }
  }
}

/** End `e`'s flight where it stands; the herd drives take it from there. */
function calm(world: World, e: Entity): void {
  world.remove(e, Frightened);
  clearNavState(world, e);
}
