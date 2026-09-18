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
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type HalfCellNode, hexagonRing, hexDistance, positionOfNode } from '../../nav/halfcell.js';
import { findPath } from '../../nav/pathfinding/index.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { nodeLatticeDistance } from '../../nav/terrain/lattice-distance.js';
import { HALF_COLUMN } from '../../nav/world-metric.js';
import type { ContentContext, System, SystemContext } from '../context.js';
import {
  dynamicBlockOverlay,
  hexDisc,
  vehicleAnchor,
  vehicleBlockedCells,
  vehicleFootprintNodes,
} from '../footprint/index.js';
import { groundBlockOverlay, vehicleClearance } from '../footprint/vehicle-clearance.js';
import { redirectRoute } from '../movement/nav-state.js';
import { awaitsDraughtAnimal, isSiegeVehicle, vehicleTraversal } from '../readviews/vehicles.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { endChat } from '../social/index.js';
import { canonicalById, NodeBuckets } from '../spatial/nodes.js';

// The mover of docs/formats/VEHICLES.md "Movement": a goto is refused without a commander or for a
// target off the vehicle's continent or walk range, the route runs over the shared graph, on land or
// on water by the vehicle's traversal class, through nodes whose free-size class admits the vehicle's
// `logicSize`, each leg takes the ground's move period scaled by its edge's length, the footprint
// travels with the anchor and shoves the settlers it lands on. A ship that starts a drive leaves its
// mooring; one on a dock drive moors again where it arrives (`dock.ts`).

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

/** The ticks a vehicle spends crossing one E/W step from a node whose ground reads class `g`. */
export function vehicleMovePeriod(g: number, siege: boolean): number {
  const period = (g * MOVE_PERIOD_PER_CLASS + MOVE_PERIOD_BASE) << (siege ? SIEGE_PERIOD_SHIFT : 0);
  return Math.max(MOVE_PERIOD_MIN, period);
}

/** The progress a tick adds toward {@link NODE_PROGRESS_FULL} under `period`: `(period + 9999) / period`,
 *  the original's integer division. */
export function vehicleProgressPerTick(period: number): number {
  return Math.floor((period + NODE_PROGRESS_FULL - 1) / period);
}

const ROUNDING_HALF: Fixed = fx.div(ONE, fx.fromInt(2));

/**
 * The ticks a leg over a lattice edge of world length `edge` takes: the node period scaled by the edge
 * over the E/W step, rounded to whole ticks, at least one. Approximation: the original's counter runs per
 * node whatever the step; the 8-direction lattice's edges span 19 to 51 px, so an unscaled period would
 * swing the vehicle's speed by 2.7x from leg to leg. The scale keeps one ground speed on every heading.
 */
export function vehicleLegTicks(period: number, edge: Fixed): number {
  const scaled = fx.mulDiv(fx.fromInt(period), edge, HALF_COLUMN);
  return Math.max(1, fx.toInt(fx.add(scaled, ROUNDING_HALF)));
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

/** The continent key a vehicle's goto compares: the anchor's static component, a land or a water
 *  label alike. -1 on a node no mover enters. */
function continentOf(terrain: TerrainGraph, node: NodeId): number {
  return terrain.componentOf(node);
}

/**
 * The walk-block a vehicle routes under: ground blockers, nodes whose free-size class is below the
 * vehicle's `logicSize`, and every other vehicle's standing cells. Its own cells are exempt so a
 * catapult can step through its own ring.
 */
export function vehicleWalkBlocks(
  world: World,
  ctx: ContentContext,
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
 * hexagon-ring order out to `radius` ({@link VEHICLE_TARGET_SNAP_RADIUS} by default) that is on the map,
 * open under the vehicle's walk-block, on the vehicle's continent and not `exclude`d. Null when nothing
 * qualifies. Shared by the goto order, the map script's `SendVehicle` and the trader's move near a house.
 */
export function snapVehicleTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  target: HalfCellNode,
  options: { readonly radius?: number; readonly exclude?: (node: NodeId) => boolean } = {},
): NodeId | null {
  const state = world.tryGet(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  if (state === undefined || anchor === null || !terrain.inBounds(anchor.hx, anchor.hy)) return null;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return null;
  const continent = continentOf(terrain, terrain.nodeAt(anchor.hx, anchor.hy));
  if (continent < 0) return null;
  const blocked = vehicleWalkBlocks(world, ctx, terrain, vehicle, type);
  const radius = options.radius ?? VEHICLE_TARGET_SNAP_RADIUS;
  for (let r = 0; r <= radius; r++) {
    for (const { point } of hexagonRing(target, r)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const node = terrain.nodeAt(point.hx, point.hy);
      if (continentOf(terrain, node) !== continent || blocked.has(node)) continue;
      if (options.exclude?.(node) === true) continue;
      return node;
    }
  }
  return null;
}

export function refuseMove(
  world: World,
  ctx: SystemContext,
  vehicle: Entity,
  reason: 'noCommander' | 'noPath' | 'noAnimal',
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
  const route = vehicleRouteTo(world, ctx, terrain, vehicle, goal);
  if (route === null) return false;
  const state = world.get(vehicle, Vehicle);
  if (state.moored || state.heldGoal !== null) {
    // Casting off: a walk that starts clears the moored flag (`l_StartAtomicWalk`), and a goal held for
    // boarding is consumed by the drive that replaces it.
    const live = world.mut(vehicle, Vehicle);
    live.moored = false;
    live.heldGoal = null;
  }
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

/** The nodes a drive from the vehicle's anchor to `goal` would enter, the first next, over the vehicle's
 *  walk-block; null when no route exists. */
export function vehicleRouteTo(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: NodeId,
): HalfCellNode[] | null {
  const state = world.get(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (anchor === null || type === undefined) return null;
  const start = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const blocked = vehicleWalkBlocks(world, ctx, terrain, vehicle, type);
  const path = findPath(terrain, start, goal, blocked, undefined, vehicleTraversal(type));
  return path === null ? null : path.slice(1).map((node) => nodeOf(terrain, node));
}

export function nodeOf(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const { x, y } = terrain.coordsOf(node);
  return { hx: x, hy: y };
}

/**
 * A ship arriving on its dock drive lies moored where it stopped, its door on the stored mooring point
 * (`CurrentTask_DoPerform` sets the flag when the dock clip ends; approximation: the clip has no
 * graphics record here, so the ship moors on the arrival tick).
 */
export function moorVehicle(world: World, ctx: SystemContext, vehicle: Entity): void {
  const live = world.mut(vehicle, Vehicle);
  live.task = 'none';
  if (live.mooring === null) return;
  live.moored = true;
  ctx.events.emit({
    kind: 'vehicleDocked',
    entity: vehicle,
    player: world.tryGet(vehicle, Owner)?.player ?? null,
    at: { hx: live.mooring.hx, hy: live.mooring.hy },
  });
}

/** A dock drive that lost its way forgets the shore it aimed at, the way the original's task 1 falls
 *  back to idle behind its `vehicleNoPath` note. */
export function abandonDock(world: World, vehicle: Entity): void {
  const state = world.get(vehicle, Vehicle);
  if (state.task !== 'docks') return;
  const live = world.mut(vehicle, Vehicle);
  live.task = 'none';
  live.heldGoal = null;
  if (!live.moored) live.mooring = null;
}

/**
 * The goto order (`e`): refused with `vehicleNoAnimal` for a cart still waiting on its draught animal,
 * with `vehicleNoCommander` while nobody commands the vehicle and with
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
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type !== undefined && awaitsDraughtAnimal(type, state)) {
    refuseMove(world, ctx, e, 'noAnimal'); // before the commander gate: nobody can attach to such a cart
    return false;
  }
  if (vehicleCommander(state) === null) {
    refuseMove(world, ctx, e, 'noCommander');
    return false;
  }
  dropAttack(world, e);
  const goal = snapVehicleTarget(world, ctx, terrain, e, { hx: command.x, hy: command.y });
  if (goal === null || hexDistance(anchor, nodeOf(terrain, goal)) > VEHICLE_WALK_RANGE_NODES) {
    refuseMove(world, ctx, e, 'noPath');
    return false;
  }
  return sendVehicleTo(world, ctx, terrain, e, goal);
}

/**
 * Drive `vehicle` to `goal`, a snapped node, or hold the goal under `waitsForHuman` while the crew is
 * outside. The route is judged now in either case, so an order nobody could drive is refused with
 * `vehicleNoPath` at once instead of after the boarding (approximation: the original's pathfinder runs
 * after `l_Passengers_MoveIn`). The trader's move near a house takes this seam past the goto's walk-range
 * gate. Returns whether a drive or a held goal now stands.
 */
export function sendVehicleTo(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: NodeId,
): boolean {
  if (!crewInside(world.get(vehicle, Vehicle))) {
    if (vehicleRouteTo(world, ctx, terrain, vehicle, goal) === null) {
      refuseMove(world, ctx, vehicle, 'noPath');
      return false;
    }
    const live = world.mut(vehicle, Vehicle);
    live.heldGoal = nodeOf(terrain, goal);
    live.task = 'waitsForHuman';
    return true;
  }
  if (!startVehicleDrive(world, ctx, terrain, vehicle, goal)) {
    refuseMove(world, ctx, vehicle, 'noPath');
    return false;
  }
  const live = world.mut(vehicle, Vehicle);
  live.task = 'none';
  live.mooring = null; // a goto overrides a dock under way; the ship stays at sea on arrival
  return true;
}

/** A player's goto or stop supersedes whatever the vehicle was firing at; the stance stays. */
function dropAttack(world: World, e: Entity): void {
  if (world.get(e, Vehicle).attack === null) return;
  const live = world.mut(e, Vehicle);
  live.attack = null;
  if (live.task === 'attacks') live.task = 'none';
}

/** Whether every seated rider, the commander among them, is inside. */
export function crewInside(state: VehicleStateView): boolean {
  return state.passengers.every((seat) => seat === null || seat.inside);
}

/** The stop order (`p`): the drive ends on the node it is crossing, a goto or dock held for boarding
 *  is dropped, a dock under way forgets its shore, and the task reads `interrupted`. */
export function stopVehicle(world: World, command: Extract<Command, { kind: 'stopVehicle' }>): void {
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  if (state === undefined) return;
  dropAttack(world, e);
  const drive = world.tryMut(e, VehicleDrive);
  if (drive === undefined && state.heldGoal === null) return;
  if (drive !== undefined) {
    drive.route.length = 0;
    if (drive.from === null) world.remove(e, VehicleDrive);
  }
  const live = world.mut(e, Vehicle);
  live.heldGoal = null;
  live.task = 'interrupted';
  if (!live.moored) live.mooring = null;
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
    const state = world.get(e, Vehicle);
    if (next === undefined) {
      world.remove(e, VehicleDrive); // arrived, or stopped on its node
      if (state.task === 'docks') moorVehicle(world, ctx, e);
      reanchorGuard(world, e);
      continue;
    }
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
        abandonDock(world, e);
      }
      continue; // the fresh route's first leg starts next tick
    }
    const here = terrain.nodeAtClamped(anchor.hx, anchor.hy);
    const period = vehicleMovePeriod(terrain.groundSpeedClass(here), isSiegeVehicle(type));
    const live = world.mut(e, VehicleDrive);
    live.route.shift();
    live.from = anchor;
    live.increment = vehicleProgressPerTick(
      vehicleLegTicks(period, nodeLatticeDistance(terrain, here, nextNode)),
    );
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

/** A drive's end is the new guard position a holding or defending siege vehicle scans around, unless
 *  the drive was its own chase, which must not walk the guard along with it. */
function reanchorGuard(world: World, e: Entity): void {
  const state = world.get(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (anchor === null || state.attack !== null) return;
  if (state.guard !== null && state.guard.hx === anchor.hx && state.guard.hy === anchor.hy) return;
  world.mut(e, Vehicle).guard = anchor;
}

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
