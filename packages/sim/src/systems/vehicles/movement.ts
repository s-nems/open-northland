import type { VehicleType } from '@open-northland/data';
import {
  Chat,
  NODE_PROGRESS_FULL,
  Owner,
  Position,
  Rider,
  unseatPassenger,
  Vehicle,
  VehicleDrive,
  VehicleMarchRoute,
  VehicleRoute,
  type VehicleStateView,
  vehicleCommander,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type HalfCellNode, hexagonRing, hexDistance, positionOfNode } from '../../nav/halfcell.js';
import { findPath, joinCorridor } from '../../nav/pathfinding/index.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, System, SystemContext } from '../context.js';
import {
  dynamicBlockOverlay,
  hexDisc,
  vehicleAnchor,
  vehicleBlockedCells,
  vehicleFootprintNodes,
} from '../footprint/index.js';
import { landVehicleFits, vehicleStandable } from '../footprint/vehicle-clearance.js';
import { isTravelling, redirectRoute } from '../movement/nav-state.js';
import { walkTurnSteps } from '../movement/turning.js';
import {
  awaitsDraughtAnimal,
  isShipVehicle,
  isSiegeVehicle,
  vehicleTraversal,
} from '../readviews/vehicles.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { stationaryOwnedSettlers } from '../settlers/planner/spacing.js';
import { endChat } from '../social/index.js';
import type { NodeBuckets } from '../spatial/nodes.js';
import {
  facingOfStep,
  restingHelm,
  sailLeg,
  shipCourse,
  swingHull,
  VEHICLE_TURN_TICKS_PER_DIRECTION,
} from './helm.js';
import type { VehicleOrderRoutes } from './order-routes.js';
import { seaRegions } from './sea-regions.js';

// The mover of docs/formats/VEHICLES.md "Movement": a goto is refused without a commander or for a
// target off the vehicle's continent, reaches as far as the continent or sea does (deviation: the
// original holds a goto to a walk range), the route runs over the shared graph, on land or on water by
// the vehicle's traversal class, through nodes the vehicle passes (`vehicleWalkBlocks`: a
// land vehicle squeezes through narrow gaps) to a goal it may stand on (`vehicleRestBlocks`: the plain
// free-size class). Each leg takes the ground's move period per map point it crosses plus its turn (a
// ship turns under way, `helm.ts`), the footprint travels with the anchor and shoves the settlers it
// lands on. A ship that starts a drive leaves its mooring; one on a dock drive moors again where it
// arrives (`dock.ts`).

/** The longest lattice edge, in map points: the most a route's first node lies from where it leaves. */
const LATTICE_EDGE_MAX_POINTS = 2;

/** How far around a clicked target the goto looks for a node the vehicle may stand on, in hexagon rings. */
export const VEHICLE_TARGET_SNAP_RADIUS = 9;

/** The move period terms: a map point takes `max(MIN_PERIOD, (g * PERIOD_PER_CLASS + PERIOD_BASE) << siege)`
 *  ticks, `g` the roughness of the node it leaves (original behavior). */
const MOVE_PERIOD_BASE = 4;
const MOVE_PERIOD_PER_CLASS = 2;
const MOVE_PERIOD_MIN = 3;
/** The catapult crosses a node in twice the period: a one-bit shift of the sum. */
const SIEGE_PERIOD_SHIFT = 1;
/** The ticks a vehicle spends crossing one map point from a node whose ground reads class `g`. */
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
 * The ticks a leg of `mapPoints` hexagon steps takes under `period`: the original's per-node counter
 * charges the period at every map point whatever its drawn length, so a vehicle crosses a N/S step
 * faster on screen than an E/W one, as in the original. A lattice edge is one or two map points.
 */
export function vehicleLegTicks(period: number, mapPoints: number): number {
  return period * Math.max(1, mapPoints);
}

/** The continent key a vehicle's goto compares: the anchor's static component, a land or a water
 *  label alike. -1 on a node no mover enters. */
function continentOf(terrain: TerrainGraph, node: NodeId): number {
  return terrain.componentOf(node);
}

/** Whether `type` may pass a node by its size: a ship by the water's free-size class, a land vehicle by
 *  {@link landVehicleFits}. */
function vehiclePasses(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  type: VehicleType,
): (node: NodeId) => boolean {
  if (vehicleTraversal(type) === 'land') return landVehicleFits(world, ctx, terrain, type.logicSize);
  return vehicleStandable(world, ctx, terrain, type.logicSize);
}

/**
 * The walk-block a vehicle routes under: ground blockers, nodes its size does not pass
 * ({@link vehiclePasses}), and every other vehicle's standing cells. Its own cells are exempt so a
 * catapult can step through its own ring.
 */
export function vehicleWalkBlocks(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  type: VehicleType,
): BlockOverlay {
  return blocksUnder(world, ctx, terrain, vehicle, vehiclePasses(world, ctx, terrain, type));
}

/**
 * The walk-block a vehicle's stopping place is chosen under: {@link vehicleWalkBlocks} with the plain
 * free-size class, so a vehicle never parks in a gap it may only pass, where its disc would seal the
 * lane for other vehicles. For goals, parking and firing spots; a route still runs under the walk-block.
 */
export function vehicleRestBlocks(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  type: VehicleType,
): BlockOverlay {
  return blocksUnder(world, ctx, terrain, vehicle, vehicleStandable(world, ctx, terrain, type.logicSize));
}

function blocksUnder(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  fits: (node: NodeId) => boolean,
  answers?: Map<NodeId, boolean>,
): BlockOverlay {
  const ground = dynamicBlockOverlay(world, ctx, terrain);
  const vehicles = vehicleBlockedCells(world, ctx, terrain);
  const own = new Set(vehicleFootprintNodes(world, ctx.content, terrain, vehicle));
  return {
    has: (node) => {
      const held = answers?.get(node);
      if (held !== undefined) return held;
      const answer = ground.has(node) || !fits(node) || (vehicles.has(node) && !own.has(node));
      answers?.set(node, answer);
      return answer;
    },
    size: ground.size + vehicles.size + 1, // never empty: the clearance term is not a set
  };
}

/**
 * Snap a clicked target to the node the vehicle may stand on: the target itself, else the first node in
 * hexagon-ring order out to `radius` ({@link VEHICLE_TARGET_SNAP_RADIUS} by default) that is on the map,
 * open under the vehicle's rest block ({@link vehicleRestBlocks}), on the vehicle's continent and not
 * `exclude`d. Null when nothing qualifies. Shared by the goto order, the map script's `SendVehicle` and
 * the trader's move near a house.
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
  const blocked = vehicleRestBlocks(world, ctx, terrain, vehicle, type);
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
 * Drive `vehicle` to `goal`, an already snapped node: the route is found now over
 * the vehicle's walk-block and the drive starts its first leg on the next movement pass. False when no
 * route exists. A drive already under way is replaced.
 */
export function startVehicleDrive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: NodeId,
  orders?: VehicleOrderRoutes,
): boolean {
  const route = vehicleRouteTo(world, ctx, terrain, vehicle, goal, orders);
  if (route === null) return false;
  castOff(world, vehicle);
  deliverRoute(world, ctx, vehicle, nodeOf(terrain, goal), route);
  return true;
}

/** Casting off: a walk that starts clears the moored flag (original behavior), and a goal held for
 *  boarding is consumed by the drive that replaces it. */
function castOff(world: World, vehicle: Entity): void {
  const state = world.get(vehicle, Vehicle);
  if (!state.moored && state.heldGoal === null) return;
  const live = world.mut(vehicle, Vehicle);
  live.moored = false;
  live.heldGoal = null;
}

/** Hand `vehicle` `route` to `goal`: a drive starts, or one under way finishes its leg, a ship keeping
 *  its way, and follows the new route beyond it. */
function deliverRoute(
  world: World,
  ctx: ContentContext,
  vehicle: Entity,
  goal: HalfCellNode,
  route: readonly HalfCellNode[],
): void {
  const drive = world.tryMut(vehicle, VehicleDrive);
  if (drive === undefined) {
    const state = world.get(vehicle, Vehicle);
    const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
    world.add(vehicle, VehicleDrive, {
      goal,
      step: 0,
      from: null,
      progress: 0,
      increment: 0,
      helm: type !== undefined && isShipVehicle(type) ? restingHelm(state.facing) : null,
    });
  } else {
    drive.goal = goal;
    drive.step = 0;
  }
  const held = world.tryGet(vehicle, VehicleRoute);
  if (held === undefined) world.add(vehicle, VehicleRoute, { nodes: route });
  else if (held.nodes !== route) world.mut(vehicle, VehicleRoute).nodes = route; // a held route drives on as is
}

/**
 * Start the drive to `goal` a held goto found its route for when the crew was asked in: the vehicle has
 * stood still since, so the route still leads from its node, and a node that closed meanwhile re-routes
 * at step time. Without such a route, ending at `goal` and leaving from beside the vehicle, the route is
 * found now. False when none exists.
 */
export function startHeldDrive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: NodeId,
): boolean {
  const held = world.tryGet(vehicle, VehicleRoute)?.nodes;
  const anchor = vehicleAnchor(world, vehicle);
  const first = held?.[0];
  const last = held?.at(-1);
  const fits =
    held !== undefined &&
    !world.has(vehicle, VehicleDrive) &&
    anchor !== null &&
    first !== undefined &&
    last !== undefined &&
    terrain.nodeAtClamped(last.hx, last.hy) === goal &&
    hexDistance(anchor, first) <= LATTICE_EDGE_MAX_POINTS;
  if (!fits) return startVehicleDrive(world, ctx, terrain, vehicle, goal);
  castOff(world, vehicle);
  deliverRoute(world, ctx, vehicle, nodeOf(terrain, goal), held);
  return true;
}

/** End `vehicle`'s drive, its route with it. */
export function endDrive(world: World, vehicle: Entity): void {
  world.remove(vehicle, VehicleDrive);
  world.remove(vehicle, VehicleRoute);
}

/** Cut a drive's route after the leg under way. False when no drive stands. */
export function cutRoute(world: World, vehicle: Entity): boolean {
  if (!world.has(vehicle, VehicleDrive)) return false;
  if (routeAhead(world, vehicle) > 0) {
    world.mut(vehicle, VehicleRoute).nodes = [];
    world.mut(vehicle, VehicleDrive).step = 0;
  }
  return true;
}

/** How far (Manhattan half-cell nodes) a march may stand from its kept route and still rejoin it.
 *  Authored: past a chase within a catapult's range band, far under a route across a continent. */
const MARCH_REJOIN_HOP_NODES = 48;

/** Keep the rest of `vehicle`'s march route when a fight is about to cut it: only a drive to the march's
 *  own goal is the march's, a chase is not. */
export function keepMarchRoute(world: World, vehicle: Entity): void {
  const { march } = world.get(vehicle, Vehicle);
  const drive = world.tryGet(vehicle, VehicleDrive);
  const route = world.tryGet(vehicle, VehicleRoute);
  if (march === null || drive === undefined || route === undefined) return;
  if (drive.goal.hx !== march.goal.hx || drive.goal.hy !== march.goal.hy) return;
  if (drive.step >= route.nodes.length) return;
  const kept = { goal: { hx: march.goal.hx, hy: march.goal.hy }, nodes: route.nodes.slice(drive.step) };
  if (world.has(vehicle, VehicleMarchRoute)) {
    const live = world.mut(vehicle, VehicleMarchRoute);
    live.goal = kept.goal;
    live.nodes = kept.nodes;
  } else world.add(vehicle, VehicleMarchRoute, kept);
}

/**
 * Drive `vehicle` back onto the march route to `goal` a fight cut short: a short hop onto the kept
 * route near where it stands, then the kept rest of the way (`joinCorridor`, which also bounds the hop
 * and cuts any loop). False with no kept route to `goal` or no short way onto it, which leaves a full
 * route to the caller; the kept route is used once.
 */
export function rejoinMarch(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: HalfCellNode,
): boolean {
  const kept = world.tryGet(vehicle, VehicleMarchRoute);
  if (kept === undefined) return false;
  world.remove(vehicle, VehicleMarchRoute);
  const type = contentIndex(ctx.content).vehicles.get(world.get(vehicle, Vehicle).vehicleType);
  const anchor = vehicleAnchor(world, vehicle);
  if (type === undefined || anchor === null || kept.goal.hx !== goal.hx || kept.goal.hy !== goal.hy) {
    return false;
  }
  const joined = joinCorridor(
    terrain,
    kept.nodes.map(({ hx, hy }) => terrain.nodeAtClamped(hx, hy)),
    terrain.nodeAtClamped(anchor.hx, anchor.hy),
    terrain.nodeAtClamped(goal.hx, goal.hy),
    vehicleWalkBlocks(world, ctx, terrain, vehicle, type),
    { explored: 0 },
    MARCH_REJOIN_HOP_NODES,
    vehicleTraversal(type),
  );
  if (joined === null) return false;
  deliverRoute(
    world,
    ctx,
    vehicle,
    { hx: goal.hx, hy: goal.hy },
    joined.slice(1).map((node) => nodeOf(terrain, node)),
  );
  return true;
}

/** The nodes a drive still has to enter. */
function routeAhead(world: World, vehicle: Entity): number {
  const nodes = world.tryGet(vehicle, VehicleRoute)?.nodes.length ?? 0;
  return Math.max(0, nodes - (world.tryGet(vehicle, VehicleDrive)?.step ?? 0));
}

/** The nodes a drive from the vehicle's anchor to `goal` would enter, the first next, over the vehicle's
 *  walk-block; null when no route exists. */
export function vehicleRouteTo(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: NodeId,
  orders?: VehicleOrderRoutes,
): HalfCellNode[] | null {
  const state = world.get(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (anchor === null || type === undefined) return null;
  const start = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  // The synchronous search cannot change these blockers; keep its repeated node probes local.
  const blocked = blocksUnder(
    world,
    ctx,
    terrain,
    vehicle,
    vehiclePasses(world, ctx, terrain, type),
    new Map<NodeId, boolean>(),
  );
  const traversal = vehicleTraversal(type);
  if (traversal === 'water' && start !== goal && !sailsTo(world, ctx, terrain, type, start, goal))
    return null;
  const group = `${world.tryGet(vehicle, Owner)?.player ?? -1}:${traversal}:${type.logicSize}`;
  const borrowed = orders?.borrow(terrain, group, blocked, start, goal, traversal) ?? null;
  if (borrowed !== null) return borrowed.slice(1).map((node) => nodeOf(terrain, node));
  const path = findPath(terrain, start, goal, blocked, undefined, traversal);
  if (path !== null) orders?.offer(group, path);
  return path === null ? null : path.slice(1).map((node) => nodeOf(terrain, node));
}

/** Whether `goal` lies in a part of the sea a ship of `type` on `start` can sail into: a lookup that
 *  refutes a goal past a strait too narrow for the hull before the search floods the whole sea. */
function sailsTo(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  type: VehicleType,
  start: NodeId,
  goal: NodeId,
): boolean {
  const regions = seaRegions(world, ctx, terrain, type.logicSize);
  return regions.regionsFrom(start).includes(regions.regionOf(goal));
}

export function nodeOf(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const { x, y } = terrain.coordsOf(node);
  return { hx: x, hy: y };
}

/**
 * A ship arriving on its dock drive lies moored where it stopped, its door on the stored mooring point
 * (the original sets the flag when the dock clip ends; approximation: the clip has no
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
  dropHeldGoal(world, vehicle);
  if (!live.moored) live.mooring = null;
}

/**
 * The goto order (`e`): refused with `vehicleNoAnimal` for a cart still waiting on its draught animal,
 * with `vehicleNoCommander` while nobody commands the vehicle and with `vehicleNoPath` when the target
 * snaps to nothing on the vehicle's continent or has no route. A crew still outside is boarded first:
 * the goal is held under the `waitsForHuman` task and the drive starts once everyone is inside (the
 * original boards its crew ahead of any target). Approximation: the original ignores an off-continent
 * target silently and raises `vehicleNoPath` only from its pathfinder. Returns whether a drive or a held
 * goal now stands.
 */
export function moveVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveVehicle' }>,
  orders?: VehicleOrderRoutes,
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
  if (goal === null) {
    refuseMove(world, ctx, e, 'noPath');
    return false;
  }
  if (!sendVehicleTo(world, ctx, terrain, e, goal, orders)) return false;
  if (command.attackMove === true && type !== undefined && isSiegeVehicle(type)) {
    world.mut(e, Vehicle).march = { goal: nodeOf(terrain, goal), restUntil: 0 };
  }
  return true;
}

/**
 * Drive `vehicle` to `goal`, a snapped node, or hold the goal under `waitsForHuman` while the crew is
 * outside. The route is judged now in either case, so an order nobody could drive is refused with
 * `vehicleNoPath` at once instead of after the boarding (approximation: the original's pathfinder runs
 * after the boarding). Returns whether a drive or a held goal now stands.
 */
export function sendVehicleTo(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  goal: NodeId,
  orders?: VehicleOrderRoutes,
): boolean {
  if (!crewInside(world.get(vehicle, Vehicle))) {
    const route = vehicleRouteTo(world, ctx, terrain, vehicle, goal, orders);
    if (route === null) {
      refuseMove(world, ctx, vehicle, 'noPath');
      return false;
    }
    const live = world.mut(vehicle, Vehicle);
    live.heldGoal = nodeOf(terrain, goal);
    live.task = 'waitsForHuman';
    // Held for the boarding to drive on, so a route that may cross a whole sea is found once; a drive
    // still under way keeps its own.
    if (!world.has(vehicle, VehicleDrive)) {
      if (world.has(vehicle, VehicleRoute)) world.mut(vehicle, VehicleRoute).nodes = route;
      else world.add(vehicle, VehicleRoute, { nodes: route });
    }
    return true;
  }
  if (!startVehicleDrive(world, ctx, terrain, vehicle, goal, orders)) {
    refuseMove(world, ctx, vehicle, 'noPath');
    return false;
  }
  const live = world.mut(vehicle, Vehicle);
  live.task = 'none';
  live.mooring = null; // a goto overrides a dock under way; the ship stays at sea on arrival
  return true;
}

/**
 * Free `rider`'s seat on `vehicle`. A land vehicle left with no commander stops after the leg under way,
 * since no commander means no drive, and its march and target lapse with it; the drive's end still
 * settles it out of a gap. Its own drive into a ship goes on, as the load order needs no crew. A ship
 * sails on: nobody can board one at sea, so stopping it there would strand it for good.
 */
export function vacateSeat(world: World, vehicle: Entity, rider: Entity): void {
  unseatPassenger(world, vehicle, rider);
  const state = world.get(vehicle, Vehicle);
  if (vehicleCommander(state) !== null || state.task === 'boardsShip') return;
  const helm = world.tryGet(vehicle, VehicleDrive)?.helm;
  if (helm !== undefined && helm !== null) return;
  dropAttack(world, vehicle);
  cutRoute(world, vehicle);
}

/** A player's goto or stop supersedes whatever the vehicle was firing at and its march; the stance
 *  stays. */
function dropAttack(world: World, e: Entity): void {
  endMarch(world, e);
  const state = world.get(e, Vehicle);
  if (state.attack === null) return;
  const live = world.mut(e, Vehicle);
  live.attack = null;
  if (live.task === 'attacks') live.task = 'none';
}

/** End an attack-move, the route a fight kept for it with it. */
export function endMarch(world: World, e: Entity): void {
  if (world.get(e, Vehicle).march !== null) world.mut(e, Vehicle).march = null;
  world.remove(e, VehicleMarchRoute);
}

/** Drop a goto or dock point held for the crew, and the route a held goto was judged by; a drive under
 *  way keeps its own. */
export function dropHeldGoal(world: World, e: Entity): void {
  if (world.get(e, Vehicle).heldGoal !== null) world.mut(e, Vehicle).heldGoal = null;
  if (!world.has(e, VehicleDrive)) world.remove(e, VehicleRoute);
}

/** Whether every seated rider, the commander among them, is inside. */
export function crewInside(state: VehicleStateView): boolean {
  return state.passengers.every((seat) => seat === null || seat.inside);
}

/** The stop order (`p`): the drive ends on the node it is crossing, a goto, dock or attack held for
 *  boarding is dropped and its riders still outside are no longer asked in, a dock under way forgets its
 *  shore, and the task reads `interrupted`. */
export function stopVehicle(world: World, command: Extract<Command, { kind: 'stopVehicle' }>): void {
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  if (state === undefined) return;
  const held = state.heldGoal !== null || state.task === 'waitsForHuman';
  dropAttack(world, e);
  const drive = world.tryGet(e, VehicleDrive);
  if (drive === undefined && !held) return;
  if (drive !== undefined) {
    cutRoute(world, e);
    if (drive.from === null) {
      endDrive(world, e);
      reanchorGuard(world, e);
    }
  }
  if (held) stopAskingCrewIn(world, state);
  dropHeldGoal(world, e);
  const live = world.mut(e, Vehicle);
  live.task = 'interrupted';
  if (!live.moored) live.mooring = null;
}

/** Clear the boarding request on every rider still outside, so a lapsed order stops pulling them in. */
function stopAskingCrewIn(world: World, state: VehicleStateView): void {
  for (const seat of state.passengers) {
    if (seat === null || seat.inside) continue;
    const rider = world.tryGet(seat.entity, Rider);
    if (rider?.boarding === true) world.mut(seat.entity, Rider).boarding = false;
  }
}

/**
 * Advance every drive one tick. A leg under way gains its increment and ends once full; a vehicle
 * between legs enters its next node, re-routing when that node closed since the route was found and
 * giving up with `vehicleNoPath` when nothing leads on. Entering a node moves the anchor and footprint
 * there at once, turns a land vehicle to face the step or sets a ship's helm onto it, and shoves the
 * settlers standing inside the footprint (approximation: the original moves its anchor halfway through
 * the leg).
 */
export const vehicleMovementSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  let standing: NodeBuckets | undefined;
  for (const e of world.canonicalQuery(VehicleDrive, Vehicle, Position)) {
    const drive = world.get(e, VehicleDrive);
    const route = world.tryGet(e, VehicleRoute)?.nodes ?? [];
    if (drive.from !== null && drive.helm !== null) {
      const end = vehicleAnchor(world, e);
      if (end === null) continue;
      sailLeg(world, e, facingOfStep(drive.from, end), shipCourse(end, route, drive.step), false);
      continue;
    }
    if (drive.from !== null) {
      const live = world.mut(e, VehicleDrive);
      live.progress += live.increment;
      if (live.progress >= NODE_PROGRESS_FULL) {
        live.from = null;
        live.progress = 0;
      }
      continue;
    }
    const next = route[drive.step];
    const state = world.get(e, Vehicle);
    if (next === undefined && drive.helm !== null && state.facing !== drive.helm.heading) {
      const helm = world.mut(e, VehicleDrive).helm;
      if (helm !== null) swingHull(world, e, helm); // a ship finishes swinging onto its last course
      continue;
    }
    if (next === undefined) {
      if (state.task !== 'interrupted' && settleOutOfGap(world, ctx, terrain, e)) continue;
      endDrive(world, e); // arrived, or stopped on its node
      if (state.task === 'docks') moorVehicle(world, ctx, e);
      reanchorGuard(world, e);
      continue;
    }
    const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
    const anchor = vehicleAnchor(world, e);
    if (type === undefined || anchor === null) {
      endDrive(world, e);
      continue;
    }
    const nextNode = terrain.nodeAtClamped(next.hx, next.hy);
    if (vehicleWalkBlocks(world, ctx, terrain, e, type).has(nextNode)) {
      const goal = terrain.nodeAtClamped(drive.goal.hx, drive.goal.hy);
      if (!startVehicleDrive(world, ctx, terrain, e, goal)) {
        endDrive(world, e);
        refuseMove(world, ctx, e, 'noPath');
        abandonDock(world, e);
        if (!settleOutOfGap(world, ctx, terrain, e)) reanchorGuard(world, e);
      }
      continue; // the fresh route's first leg starts next tick
    }
    const here = terrain.nodeAtClamped(anchor.hx, anchor.hy);
    const period = vehicleMovePeriod(terrain.resistanceAt(here), isSiegeVehicle(type));
    const facing = facingOfStep(anchor, next);
    const course = shipCourse(anchor, route, drive.step) ?? facing;
    const live = world.mut(e, VehicleDrive);
    live.step += 1;
    live.from = anchor;
    live.increment = vehicleProgressPerTick(vehicleLegTicks(period, hexDistance(anchor, next)));
    // Written on every node entered, a ship holding its heading included: the blocker caches learn
    // that a vehicle's cells moved from the `Vehicle` store's value writes (`footprint/vehicle-anchors.ts`).
    const vehicle = world.mut(e, Vehicle);
    if (live.helm !== null) {
      live.helm.heading = course;
      live.progress = 0;
    } else {
      // A land vehicle turns on `from`: progress below zero draws it there, facing the new way.
      const turnTicks = walkTurnSteps(state.facing, facing) * VEHICLE_TURN_TICKS_PER_DIRECTION;
      live.progress = live.increment * (1 - turnTicks);
      vehicle.facing = facing;
    }
    const at = positionOfNode(next.hx, next.hy);
    const pos = world.mut(e, Position);
    pos.x = at.x;
    pos.y = at.y;
    standing ??= stationaryOwnedSettlers(world);
    shoveSettlers(world, ctx, terrain, standing, next, route, live.step, type.logicSize);
    if (live.helm !== null) sailLeg(world, e, facing, shipCourse(next, route, live.step), true);
  }
};

/** How far a land vehicle left in a gap looks for a node to stand on, in hexagon rings. */
const VEHICLE_SETTLE_RADIUS = 3;

/**
 * A land vehicle whose drive ends on a node it may only pass, given up, halted without its commander or
 * its goal closed meanwhile, drives on to the nearest node it may stand on, so its disc does not seal
 * the gap for other vehicles. True when that drive starts; a player's stop, or no such node in reach,
 * leaves it where it is.
 */
function settleOutOfGap(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): boolean {
  const type = contentIndex(ctx.content).vehicles.get(world.get(e, Vehicle).vehicleType);
  const anchor = vehicleAnchor(world, e);
  if (type === undefined || anchor === null || vehicleTraversal(type) !== 'land') return false;
  const here = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  if (vehicleStandable(world, ctx, terrain, type.logicSize)(here)) return false;
  const spot = snapVehicleTarget(world, ctx, terrain, e, anchor, { radius: VEHICLE_SETTLE_RADIUS });
  if (spot === null || !startVehicleDrive(world, ctx, terrain, e, spot)) return false;
  // A march that reached its goal is over, so it does not drive back onto a goal that closed.
  const march = world.get(e, Vehicle).march;
  if (march !== null && march.goal.hx === anchor.hx && march.goal.hy === anchor.hy) endMarch(world, e);
  return true;
}

/** Wherever a drive ends, arrived, stopped or given up, is the new guard position a holding or
 *  defending siege vehicle scans around, unless the drive was its own chase, which must not walk the
 *  guard along with it. */
function reanchorGuard(world: World, e: Entity): void {
  const state = world.get(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (anchor === null || state.attack !== null) return;
  if (state.guard !== null && state.guard.hx === anchor.hx && state.guard.hy === anchor.hy) return;
  world.mut(e, Vehicle).guard = anchor;
}

/** Each route's nodes by their index, so a shove asks whether a node lies ahead in a few lookups. Keyed
 *  by the route array, which a drive replaces and never edits; derived, so it cannot change a result. */
const routeIndexes = new WeakMap<readonly HalfCellNode[], Map<NodeId, number>>();

function routeIndexOf(terrain: TerrainGraph, route: readonly HalfCellNode[]): Map<NodeId, number> {
  let index = routeIndexes.get(route);
  if (index === undefined) {
    index = new Map();
    for (const [i, { hx, hy }] of route.entries()) {
      if (terrain.inBounds(hx, hy)) index.set(terrain.nodeAt(hx, hy), i);
    }
    routeIndexes.set(route, index);
  }
  return index;
}

/** Whether `node` lies under the footprint of `entered` or of a route node from index `step` on: some
 *  footprint centre lies within `logicSize` of it. */
function underRouteFootprint(
  terrain: TerrainGraph,
  node: NodeId,
  entered: NodeId,
  index: ReadonlyMap<NodeId, number>,
  step: number,
  logicSize: number,
): boolean {
  for (const { hx, hy } of hexDisc({ hx: terrain.xOf(node), hy: terrain.yOf(node) }, logicSize)) {
    if (!terrain.inBounds(hx, hy)) continue;
    const centre = terrain.nodeAt(hx, hy);
    if (centre === entered || (index.get(centre) ?? -1) >= step) return true;
  }
  return false;
}

/**
 * Send every owned settler standing inside the footprint arriving at `entered` to the nearest open node
 * outside the footprints of the whole remaining route, so one shove clears the way. `standing` holds the
 * stationary owned settlers by node; a settler mid-walk, or sent off by a shove earlier this tick, leaves
 * on its own and one held by an atomic finishes it first; a standing settler's own goal and chat give
 * way. An unowned animal is not shoved: its next wander leg steps off the disc. Approximation: how the
 * original picks the spot it sends a settler to is unconfirmed.
 */
function shoveSettlers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  standing: NodeBuckets,
  entered: HalfCellNode,
  route: readonly HalfCellNode[],
  step: number,
  logicSize: number,
): void {
  let blocked: BlockOverlay | undefined;
  const enteredNode = terrain.nodeAtClamped(entered.hx, entered.hy);
  const claimed = new Set<NodeId>();
  for (const { hx, hy } of hexDisc(entered, logicSize)) {
    for (const settler of standing.at(hx, hy)) {
      if (isTravelling(world, settler) || atomicHoldsSettler(world, settler)) continue;
      const from = terrain.nodeAtClamped(hx, hy);
      blocked ??= dynamicBlockOverlay(world, ctx, terrain);
      const walls = blocked;
      const index = routeIndexOf(terrain, route);
      const free = ringSearch(terrain, from, STAND_SEARCH_CAP, {
        accept: (n) =>
          !walls.has(n) &&
          !claimed.has(n) &&
          !underRouteFootprint(terrain, n, enteredNode, index, step, logicSize),
      });
      if (free === null) continue; // boxed in - the settler stays
      claimed.add(free);
      if (world.has(settler, Chat)) endChat(world, ctx.tick, settler); // a chat would drop the walk
      redirectRoute(world, settler, free);
    }
  }
}
