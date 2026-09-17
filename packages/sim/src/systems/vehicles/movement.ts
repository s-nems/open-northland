import type { VehicleType } from '@open-northland/data';
import {
  Chat,
  NODE_PROGRESS_FULL,
  Owner,
  PathFollow,
  Position,
  Settler,
  VEHICLE_FACINGS,
  Vehicle,
  VehicleDrive,
  type VehicleStateView,
  vehicleCommander,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type HalfCellNode, hexagonRing, hexDistance, positionOfNode } from '../../nav/halfcell.js';
import { findPath } from '../../nav/pathfinding/index.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import {
  dynamicBlockOverlay,
  hexDisc,
  vehicleAnchor,
  vehicleBlockedCells,
  vehicleFootprintNodes,
} from '../footprint/index.js';
import { groundBlockOverlay, vehicleClearance } from '../footprint/vehicle-clearance.js';
import { redirectRoute } from '../movement/nav-state.js';
import { isSiegeVehicle } from '../readviews/vehicles.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { endChat } from '../social/index.js';
import { canonicalById, NodeBuckets } from '../spatial/nodes.js';

// The land mover of docs/formats/VEHICLES.md "Movement": a goto is refused without a commander or for a
// target off the vehicle's continent or walk range, the route runs over the shared graph through nodes
// whose free-size class admits the vehicle's `logicSize`, each node takes the ground's move period, the
// footprint travels with the anchor and shoves the settlers it lands on.

/** The walk range of a vehicle goto in map-point steps from where it stands (`Pathfinder_Start(goal, 60)`,
 *  the vehicle twin of the humans' 50/63). */
export const VEHICLE_WALK_RANGE_NODES = 60;

/** How far around a clicked target the goto looks for a node the vehicle may stand on, in hexagon rings. */
export const VEHICLE_TARGET_SNAP_RADIUS = 9;

/** The move period terms: a node takes `max(MIN_PERIOD, (g * PERIOD_PER_CLASS + PERIOD_BASE) << siege)`
 *  ticks, `g` the node's ground speed class (byte-verified, `CVehicle::WalkSpeed_Update`). */
const MOVE_PERIOD_BASE = 4;
const MOVE_PERIOD_PER_CLASS = 2;
const MOVE_PERIOD_MIN = 3;
/** The catapult crosses a node in twice the period: a one-bit shift of the sum. */
const SIEGE_PERIOD_SHIFT = 1;

/** The node pitch in pixels, the measured 68 x 38 px projection halved, for the facing pick. */
const HALF_COLUMN_PX = 34;
const HALF_ROW_PX = 19;
/** The six map-point directions as pixel vectors in `HEX_DIRECTIONS` order: E, SE, SW, W, NW, NE. */
const FACING_VECTORS_PX: readonly (readonly [number, number])[] = [
  [HALF_COLUMN_PX, 0],
  [HALF_COLUMN_PX / 2, HALF_ROW_PX],
  [-HALF_COLUMN_PX / 2, HALF_ROW_PX],
  [-HALF_COLUMN_PX, 0],
  [-HALF_COLUMN_PX / 2, -HALF_ROW_PX],
  [HALF_COLUMN_PX / 2, -HALF_ROW_PX],
];

/** The ticks a vehicle spends on one node whose ground reads class `g`. */
export function vehicleMovePeriod(g: number, siege: boolean): number {
  const period = (g * MOVE_PERIOD_PER_CLASS + MOVE_PERIOD_BASE) << (siege ? SIEGE_PERIOD_SHIFT : 0);
  return Math.max(MOVE_PERIOD_MIN, period);
}

/** The progress a tick adds toward {@link NODE_PROGRESS_FULL} under `period`: `(period + 9999) / period`,
 *  the original's integer division. */
export function vehicleProgressPerTick(period: number): number {
  return Math.floor((period + NODE_PROGRESS_FULL - 1) / period);
}

/**
 * The facing the six map-point directions give a lattice step: the direction whose pixel vector has the
 * largest dot product with the step in world pixels, where an odd row sits half a node to the right.
 * Every lattice edge is one or two equal hexagon steps, so the pick is exact; the tie-break only guards
 * a degenerate zero step. Approximation: the original turns toward its own six-direction path.
 */
export function facingOfStep(from: HalfCellNode, to: HalfCellNode): number {
  const stagger = ((to.hy & 1) - (from.hy & 1)) * (HALF_COLUMN_PX / 2);
  const dx = (to.hx - from.hx) * HALF_COLUMN_PX + stagger;
  const dy = (to.hy - from.hy) * HALF_ROW_PX;
  let best = 0;
  let bestDot = Number.NEGATIVE_INFINITY;
  for (let facing = 0; facing < VEHICLE_FACINGS; facing++) {
    const vector = FACING_VECTORS_PX[facing];
    if (vector === undefined) continue;
    const dot = dx * vector[0] + dy * vector[1];
    if (dot > bestDot) {
      bestDot = dot;
      best = facing;
    }
  }
  return best;
}

/** The continent key a land vehicle's goto compares: the anchor's static component. -1 off land. */
function continentOf(terrain: TerrainGraph, node: NodeId): number {
  return terrain.componentOf(node);
}

/**
 * The walk-block a vehicle routes under: ground blockers, nodes whose free-size class is below the
 * vehicle's `logicSize`, and every other vehicle's standing cells. Its own cells are exempt so a
 * catapult can step through its own ring.
 */
function vehicleWalkBlocks(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  type: VehicleType,
): BlockOverlay {
  const ground = groundBlockOverlay(world, ctx, terrain);
  const clearance = vehicleClearance(world, ctx, terrain);
  const vehicles = vehicleBlockedCells(world, ctx, terrain);
  const own = new Set(vehicleFootprintNodes(world, ctx.content, terrain, vehicle));
  return {
    has: (node) =>
      ground.has(node) || clearance.classOf(node) < type.logicSize || (vehicles.has(node) && !own.has(node)),
    size: ground.size + vehicles.size + 1, // never empty: the clearance term is not a set
  };
}

/**
 * Snap a clicked target to the node the vehicle may stand on: the target itself, else the first node in
 * hexagon-ring order out to {@link VEHICLE_TARGET_SNAP_RADIUS} that is on the map, open under the
 * vehicle's walk-block and on the vehicle's continent. Null when nothing qualifies. Shared by the goto
 * order and the map script's `SendVehicle`.
 */
export function snapVehicleTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  target: HalfCellNode,
): NodeId | null {
  const state = world.tryGet(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  if (state === undefined || anchor === null || !terrain.inBounds(anchor.hx, anchor.hy)) return null;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return null;
  const continent = continentOf(terrain, terrain.nodeAt(anchor.hx, anchor.hy));
  if (continent < 0) return null;
  const blocked = vehicleWalkBlocks(world, ctx, terrain, vehicle, type);
  for (let r = 0; r <= VEHICLE_TARGET_SNAP_RADIUS; r++) {
    for (const { point } of hexagonRing(target, r)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const node = terrain.nodeAt(point.hx, point.hy);
      if (continentOf(terrain, node) === continent && !blocked.has(node)) return node;
    }
  }
  return null;
}

export function refuseMove(
  world: World,
  ctx: SystemContext,
  vehicle: Entity,
  reason: 'noCommander' | 'noPath',
): void {
  ctx.events.emit({
    kind: 'vehicleMoveRefused',
    entity: vehicle,
    player: world.tryGet(vehicle, Owner)?.player ?? null,
    reason,
  });
}

/**
 * Drive `vehicle` to `goal`, an already snapped node within the walk range: the route is found now over
 * the vehicle's walk-block and the drive starts its first leg on the next movement pass. False when no
 * route exists. A drive already under way is replaced.
 */
export function startVehicleDrive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: NodeId,
): boolean {
  const state = world.get(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (anchor === null || type === undefined) return false;
  const start = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const path = findPath(terrain, start, goal, vehicleWalkBlocks(world, ctx, terrain, vehicle, type));
  if (path === null) return false;
  const route = path.slice(1).map((node) => nodeOf(terrain, node));
  const drive = world.tryMut(vehicle, VehicleDrive);
  if (drive === undefined) {
    world.add(vehicle, VehicleDrive, {
      goal: nodeOf(terrain, goal),
      route,
      from: null,
      progress: 0,
      increment: 0,
    });
  } else {
    // A leg under way finishes on its node; only the route beyond it is replaced.
    drive.goal = nodeOf(terrain, goal);
    drive.route = route;
  }
  return true;
}

function nodeOf(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const { x, y } = terrain.coordsOf(node);
  return { hx: x, hy: y };
}

/**
 * The goto order (`e`): refused with `vehicleNoCommander` while nobody commands the vehicle and with
 * `vehicleNoPath` when the target snaps to nothing on the vehicle's continent, lies beyond the walk
 * range, or has no route. A crew still outside is boarded first: the goal is held under the
 * `waitsForHuman` task and the drive starts once everyone is inside (`CVehicle::DoUpdateAI` runs
 * `l_Passengers_MoveIn` ahead of any target). Approximation: the original ignores an off-continent
 * target silently and raises `vehicleNoPath` only from its pathfinder. Returns whether a drive or a
 * held goal now stands.
 */
export function moveVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveVehicle' }>,
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return false; // mapless sim: nothing to drive over
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (state === undefined || anchor === null || state.carrier !== null) return false;
  if (vehicleCommander(state) === null) {
    refuseMove(world, ctx, e, 'noCommander');
    return false;
  }
  const goal = snapVehicleTarget(world, ctx, terrain, e, { hx: command.x, hy: command.y });
  if (goal === null || hexDistance(anchor, nodeOf(terrain, goal)) > VEHICLE_WALK_RANGE_NODES) {
    refuseMove(world, ctx, e, 'noPath');
    return false;
  }
  if (!crewInside(state)) {
    const live = world.mut(e, Vehicle);
    live.heldGoal = nodeOf(terrain, goal);
    live.task = 'waitsForHuman';
    return true;
  }
  if (!startVehicleDrive(world, ctx, terrain, e, goal)) {
    refuseMove(world, ctx, e, 'noPath');
    return false;
  }
  if (state.task !== 'none') world.mut(e, Vehicle).task = 'none';
  return true;
}

/** Whether every seated rider, the commander among them, is inside. */
function crewInside(state: VehicleStateView): boolean {
  return state.passengers.every((seat) => seat === null || seat.inside);
}

/** The stop order (`p`): the drive ends on the node it is crossing, a goto held for boarding is
 *  dropped, and the task reads `interrupted`. */
export function stopVehicle(world: World, command: Extract<Command, { kind: 'stopVehicle' }>): void {
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  if (state === undefined) return;
  const drive = world.tryMut(e, VehicleDrive);
  if (drive === undefined && state.heldGoal === null) return;
  if (drive !== undefined) {
    drive.route.length = 0;
    if (drive.from === null) world.remove(e, VehicleDrive);
  }
  const live = world.mut(e, Vehicle);
  live.heldGoal = null;
  live.task = 'interrupted';
}

/**
 * Advance every drive one tick. A leg under way gains its increment and ends once full; a vehicle
 * between legs enters its next node, re-routing when that node closed since the route was found and
 * giving up with `vehicleNoPath` when nothing leads on. Entering a node moves the anchor and footprint
 * there at once, turns the vehicle to face the step, and shoves the settlers standing inside the
 * footprint (approximation: the original moves its anchor halfway through the leg).
 */
export const vehicleMovementSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  let standing: NodeBuckets | undefined;
  for (const e of canonicalById(world.query(VehicleDrive, Vehicle, Position))) {
    const drive = world.get(e, VehicleDrive);
    if (drive.from !== null) {
      const live = world.mut(e, VehicleDrive);
      live.progress += live.increment;
      if (live.progress >= NODE_PROGRESS_FULL) {
        live.from = null;
        live.progress = 0;
      }
      continue;
    }
    const next = drive.route[0];
    if (next === undefined) {
      world.remove(e, VehicleDrive); // arrived, or stopped on its node
      continue;
    }
    const state = world.get(e, Vehicle);
    const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
    const anchor = vehicleAnchor(world, e);
    if (type === undefined || anchor === null) {
      world.remove(e, VehicleDrive);
      continue;
    }
    const nextNode = terrain.nodeAtClamped(next.hx, next.hy);
    if (vehicleWalkBlocks(world, ctx, terrain, e, type).has(nextNode)) {
      const goal = terrain.nodeAtClamped(drive.goal.hx, drive.goal.hy);
      if (!startVehicleDrive(world, ctx, terrain, e, goal)) {
        world.remove(e, VehicleDrive);
        refuseMove(world, ctx, e, 'noPath');
      }
      continue; // the fresh route's first leg starts next tick
    }
    const here = terrain.nodeAtClamped(anchor.hx, anchor.hy);
    const period = vehicleMovePeriod(terrain.groundSpeedClass(here), isSiegeVehicle(type));
    const live = world.mut(e, VehicleDrive);
    live.route.shift();
    live.from = anchor;
    live.increment = vehicleProgressPerTick(period);
    live.progress = live.increment;
    const at = positionOfNode(next.hx, next.hy);
    const pos = world.mut(e, Position);
    pos.x = at.x;
    pos.y = at.y;
    world.mut(e, Vehicle).facing = facingOfStep(anchor, next);
    standing ??= new NodeBuckets(world, canonicalById(world.query(Settler, Position)));
    shoveSettlers(world, ctx, terrain, standing, next, live.route, type.logicSize);
  }
};

/**
 * Send every settler standing inside the footprint arriving at `entered` to the nearest open node
 * outside the footprints of the whole remaining route, so one shove clears the way. A settler mid-walk
 * leaves on its own and one held by an atomic finishes it first; a standing settler's own goal and
 * chat give way. Approximation: the original's `l_SendAwayRadial` is not read beyond its call.
 */
function shoveSettlers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  standing: NodeBuckets,
  entered: HalfCellNode,
  route: readonly HalfCellNode[],
  logicSize: number,
): void {
  const footprint = hexDisc(entered, logicSize);
  const ahead = new Set<NodeId>();
  for (const centre of [entered, ...route]) {
    for (const { hx, hy } of hexDisc(centre, logicSize)) {
      if (terrain.inBounds(hx, hy)) ahead.add(terrain.nodeAt(hx, hy));
    }
  }
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const claimed = new Set<NodeId>();
  for (const { hx, hy } of footprint) {
    for (const settler of standing.at(hx, hy)) {
      if (world.has(settler, PathFollow) || atomicHoldsSettler(world, settler)) continue;
      const from = terrain.nodeAtClamped(hx, hy);
      const free = ringSearch(terrain, from, STAND_SEARCH_CAP, {
        accept: (n) => !ahead.has(n) && !blocked.has(n) && !claimed.has(n),
      });
      if (free === null) continue; // boxed in - the settler stays
      claimed.add(free);
      if (world.has(settler, Chat)) endChat(world, ctx.tick, settler); // a chat would drop the walk
      redirectRoute(world, settler, free);
    }
  }
}
