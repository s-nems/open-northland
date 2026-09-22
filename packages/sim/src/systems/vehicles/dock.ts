import type { VehicleType } from '@open-northland/data';
import { Vehicle, VehicleDrive, vehicleCommander } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type HalfCellNode, hexagonRing, hexDistance, hexDistanceBetween } from '../../nav/halfcell.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../context.js';
import { placementBlockerVersion, vehicleAnchor } from '../footprint/index.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import {
  crewInside,
  moorVehicle,
  refuseMove,
  startVehicleDrive,
  VEHICLE_WALK_RANGE_NODES,
  vehicleWalkBlocks,
} from './movement.js';

// The dock order of docs/formats/VEHICLES.md "Ships and docking": a commanded ship boards its crew,
// scans the hexagon ring of its door distance around the clicked shore point for a node of its own
// water body it may lie at, sails there under the `docks` task with the click stored as its mooring
// point, and moors on arrival (`movement.ts`). No port building is involved.

/**
 * The nodes a ship may dock at for `point`, in the original's ring order: the map points at exactly
 * the door distance from the point that lie on the ship's own continent, within its walk range, and
 * are open under its walk-block, which is the free-size class test plus the other vehicles' cells.
 * The ship's own node qualifies as an in-place mooring.
 */
function dockCandidates(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  type: VehicleType,
  anchor: HalfCellNode,
  point: HalfCellNode,
): NodeId[] {
  const vector = type.passengerVector;
  if (vector === undefined) return [];
  const continent = terrain.componentOf(terrain.nodeAt(anchor.hx, anchor.hy));
  if (continent < 0) return [];
  const blocked = vehicleWalkBlocks(world, ctx, terrain, vehicle, type);
  const out: NodeId[] = [];
  for (const { point: ring } of hexagonRing(point, vector.distance)) {
    if (!terrain.inBounds(ring.hx, ring.hy)) continue;
    if (hexDistance(anchor, ring) > VEHICLE_WALK_RANGE_NODES) continue;
    const node = terrain.nodeAt(ring.hx, ring.hy);
    if (terrain.componentOf(node) === continent && !blocked.has(node)) out.push(node);
  }
  return out;
}

/**
 * Sail `vehicle`, its crew inside, to the first dock node around `point` it finds a route to, and
 * remember the point as the shore it moors at. False, with the `vehicleNoPath` note, when no ring
 * node takes it. Approximation: the original leaves a ship already standing on a ring node as it is;
 * here it moors in place, which is what the order asked for.
 */
export function startDock(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  point: HalfCellNode,
): boolean {
  const state = world.get(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (anchor === null || type === undefined) return false;
  const here = terrain.nodeAt(anchor.hx, anchor.hy);
  for (const node of dockCandidates(world, ctx, terrain, vehicle, type, anchor, point)) {
    if (node !== here && !startVehicleDrive(world, ctx, terrain, vehicle, node)) continue;
    if (node === here) world.remove(vehicle, VehicleDrive); // a goto under way ends here, moored
    const live = world.mut(vehicle, Vehicle);
    live.task = 'docks';
    live.heldGoal = null;
    live.mooring = { hx: point.hx, hy: point.hy };
    if (node === here) moorVehicle(world, ctx, vehicle);
    return true;
  }
  refuseMove(world, ctx, vehicle, 'noPath');
  const live = world.mut(vehicle, Vehicle);
  live.heldGoal = null;
  if (live.task === 'docks') live.task = 'none';
  return false;
}

/**
 * The dock order (`g`) - see the command doc. Refused with `vehicleNoCommander` while nobody commands
 * the ship. A crew still outside is boarded first: the point is held under the `docks` task and the
 * sail starts once everyone is inside (the original retries the order behind the crew's boarding).
 * Returns whether a dock drive or a held point now stands.
 */
export function dockVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'dockVehicle' }>,
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return false;
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (state === undefined || anchor === null || state.carrier !== null) return false;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || !isShipVehicle(type)) return false;
  if (vehicleCommander(state) === null) {
    refuseMove(world, ctx, e, 'noCommander');
    return false;
  }
  const point = { hx: command.x, hy: command.y };
  if (!crewInside(state)) {
    const live = world.mut(e, Vehicle);
    live.heldGoal = point;
    live.task = 'docks';
    return true;
  }
  return startDock(world, ctx, terrain, e, point);
}

/**
 * Where a ship may be told to dock, read the way the dock pick's overlay and click gate need it: one
 * pure answer per node over the rule {@link startDock} applies, without issuing the order.
 */
export interface MooringProbe {
  /** Whether the dock order on half-cell node `(x, y)` would find a dock node: a shore node at exactly
   *  the door distance from a water node the ship can reach. */
  canMoor(x: number, y: number): boolean;
  /** Changes whenever the answers may have; overlay frames memoize on it. */
  readonly key: string;
}

interface MooringMemo {
  readonly key: string;
  readonly terrain: TerrainGraph;
  readonly probe: MooringProbe;
}

/** One entry per world: the app probes for the one ship whose dock pick is armed. A read-path cache
 *  feeding the overlay and the click gate, never a sim decision, so it is not hashed. */
const mooringMemo = new WeakMap<World, MooringMemo>();

/**
 * The {@link MooringProbe} of `vehicle`, or null for a vehicle that takes no dock order: not a ship, or
 * riding a carrier. The reachable water is flooded once per (blocker version, ship position) over the
 * ship's walk-block and the walk range, and every land node at the door distance from it is a mooring
 * spot, so a probe costs the walk-range disc, not the coastline per node. Approximation: the original's
 * dock command takes any point, so a click at sea also moors when a ring node takes it; the probe
 * accepts walkable land only, the shore the crew can step onto.
 */
export function mooringProbe(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): MooringProbe | null {
  const state = world.tryGet(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  if (state === undefined || anchor === null || state.carrier !== null) return null;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  const vector = type?.passengerVector;
  if (type === undefined || vector === undefined || !isShipVehicle(type)) return null;
  if (!terrain.inBounds(anchor.hx, anchor.hy)) return null;
  const key = `${placementBlockerVersion(world)}:${vehicle}:${anchor.hx},${anchor.hy}`;
  const cached = mooringMemo.get(world);
  if (cached !== undefined && cached.key === key && cached.terrain === terrain) return cached.probe;
  const blocked = vehicleWalkBlocks(world, ctx, terrain, vehicle, type);
  const spots = mooringSpots(terrain, blocked, anchor, vector.distance);
  const probe: MooringProbe = {
    key,
    canMoor: (x, y) => terrain.inBounds(x, y) && spots.has(terrain.nodeAt(x, y)),
  };
  mooringMemo.set(world, { key, terrain, probe });
  return probe;
}

/** The land nodes at exactly `doorDistance` from any water node the ship can reach from `anchor`. A
 *  ship whose own node closed under it (a blocker grew beside it) sails on but cannot moor in place, the
 *  way {@link dockCandidates} drops a blocked ring node, so its own ring stays dark. */
function mooringSpots(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  anchor: HalfCellNode,
  doorDistance: number,
): ReadonlySet<NodeId> {
  const spots = new Set<NodeId>();
  for (const node of reachableWater(terrain, blocked, anchor)) {
    if (blocked.has(node)) continue; // only the start can be, as the pathfinder's blocked-start exemption
    const { x, y } = terrain.coordsOf(node);
    for (const { point } of hexagonRing({ hx: x, hy: y }, doorDistance)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const shore = terrain.nodeAt(point.hx, point.hy);
      if (terrain.isWalkable(shore)) spots.add(shore);
    }
  }
  return spots;
}

/**
 * The water nodes a ship standing on `anchor` can sail to under `blocked`, bounded to the walk-range disc
 * (approximation: a route that leaves the disc and returns is not found, where the pathfinder would
 * find it). The anchor itself counts: a ring node under the ship is an in-place mooring.
 */
function reachableWater(terrain: TerrainGraph, blocked: BlockOverlay, anchor: HalfCellNode): NodeId[] {
  const start = terrain.nodeAt(anchor.hx, anchor.hy);
  const seen = new Set<NodeId>([start]);
  const queue: NodeId[] = [start];
  const edges = new StepBuffer();
  // The array iterator re-reads `length` each step, so `queue` is a live BFS queue.
  for (const cur of queue) {
    terrain.stepsInto(cur, blocked, edges, 'water');
    for (let i = 0; i < edges.length; i++) {
      const { node } = edges.at(i);
      if (seen.has(node)) continue;
      const { x, y } = terrain.coordsOf(node);
      if (hexDistanceBetween(anchor.hx, anchor.hy, x, y) > VEHICLE_WALK_RANGE_NODES) continue;
      seen.add(node);
      queue.push(node);
    }
  }
  return queue;
}
