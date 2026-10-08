import type { VehicleType } from '@open-northland/data';
import { Vehicle, vehicleCommander } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { MAX_CLEARANCE_CLASS } from '../../nav/clearance.js';
import { type HalfCellNode, hexagonRing } from '../../nav/halfcell.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { vehicleClearance } from '../footprint/vehicle-clearance.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import {
  crewInside,
  dropHeldGoal,
  endDrive,
  moorVehicle,
  refuseMove,
  startVehicleDrive,
  vehicleWalkBlocks,
} from './movement.js';
import { type SeaRegions, seaRegions } from './sea-regions.js';

// The dock order of docs/formats/VEHICLES.md "Ships and docking": a commanded ship boards its crew,
// scans the hexagon ring of its door distance, then the slack rings beyond it, around the clicked
// shore point for a node of its own water body it may lie at, sails there under the `docks` task with the click stored as its mooring
// point, and moors on arrival (`movement.ts`). No port building is involved.

/**
 * How many rings past the door distance a dock may lie. Approximation: the original docks on the door
 * ring alone, by its authored `lmms` size lane; this build's coast comes from the ground patterns at
 * cell resolution and can sit a node off the original's, so a narrow bay the original's ring still
 * fits may have no node of the hull's size class on it here.
 */
const DOCK_RING_SLACK = 2;

/**
 * The nodes a ship may dock at for `point`, in the original's ring order, the door ring first and then
 * the {@link DOCK_RING_SLACK} rings beyond it: the map points that lie in a part of the sea the ship can
 * sail into, however far (deviation: the original holds the dock to the goto's walk range), and are
 * open under its walk-block, which is the free-size class test plus the other vehicles' cells. The
 * ship's own node qualifies as an in-place mooring.
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
  const regions = seaRegions(world, ctx, terrain, type.logicSize);
  const reach = regions.regionsFrom(terrain.nodeAt(anchor.hx, anchor.hy));
  const blocked = vehicleWalkBlocks(world, ctx, terrain, vehicle, type);
  const out: NodeId[] = [];
  for (let radius = vector.distance; radius <= vector.distance + DOCK_RING_SLACK; radius++) {
    for (const { point: ring } of hexagonRing(point, radius)) {
      if (!terrain.inBounds(ring.hx, ring.hy)) continue;
      const node = terrain.nodeAt(ring.hx, ring.hy);
      if (reach.includes(regions.regionOf(node)) && !blocked.has(node)) out.push(node);
    }
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
  // After one candidate finds no route, the water the ship can reach is flooded once and only the
  // candidates in it are searched, instead of a sea-wide search per ring node another ship cut off.
  let reached: Uint8Array | undefined;
  for (const node of dockCandidates(world, ctx, terrain, vehicle, type, anchor, point)) {
    if (reached !== undefined && reached[node] !== REACHED) continue;
    if (node !== here && !startVehicleDrive(world, ctx, terrain, vehicle, node)) {
      reached ??= reachableWater(terrain, vehicleWalkBlocks(world, ctx, terrain, vehicle, type), here);
      continue;
    }
    if (node === here) endDrive(world, vehicle); // a goto under way ends here, moored
    dropHeldGoal(world, vehicle);
    const live = world.mut(vehicle, Vehicle);
    live.task = 'docks';
    live.mooring = { hx: point.hx, hy: point.hy };
    if (node === here) moorVehicle(world, ctx, vehicle);
    return true;
  }
  refuseMove(world, ctx, vehicle, 'noPath');
  dropHeldGoal(world, vehicle);
  const live = world.mut(vehicle, Vehicle);
  if (live.task === 'docks') live.task = 'none';
  return false;
}

const REACHED = 1;

/** The nodes a ship on `start` can sail to under `blocked`, marked {@link REACHED}; the start counts,
 *  as the pathfinder lets a vehicle leave a node that closed under it. */
function reachableWater(terrain: TerrainGraph, blocked: BlockOverlay, start: NodeId): Uint8Array {
  const reached = new Uint8Array(terrain.nodeCount);
  reached[start] = REACHED;
  const queue: NodeId[] = [start];
  const edges = new StepBuffer();
  // The array iterator re-reads `length`, so `queue` is a live breadth-first queue.
  for (const current of queue) {
    terrain.stepsInto(current, blocked, edges, 'water');
    for (let i = 0; i < edges.length; i++) {
      const { node } = edges.at(i);
      if (reached[node] === REACHED) continue;
      reached[node] = REACHED;
      queue.push(node);
    }
  }
  return reached;
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
  /** Whether the dock order on half-cell node `(x, y)` would find a dock node: a shore node on the door
   *  ring or a slack ring of a water node the ship can reach. */
  canMoor(x: number, y: number): boolean;
  /** Changes whenever the answers may have; overlay frames memoize on it. */
  readonly key: string;
}

/** Where a ship's dock order would moor, as the node set behind {@link MooringProbe}. */
export interface MooringSpots {
  readonly key: string;
  readonly spots: ReadonlySet<NodeId>;
}

interface MooringMemo extends MooringSpots {
  readonly terrain: TerrainGraph;
  readonly probe: MooringProbe;
}

/** One entry per world: the app probes for the one ship whose dock pick is armed. A read-path cache
 *  feeding the overlay and the click gate, never a sim decision, so it is not hashed. */
const mooringMemo = new WeakMap<World, MooringMemo>();

/**
 * The {@link MooringProbe} of `vehicle`, or null for a vehicle that takes no dock order: not a ship, or
 * riding a carrier. Every land node on the door ring or a slack ring around the parts of the sea the
 * ship can sail into is a mooring spot, gathered once per sea labelling ({@link seaRegions}), so a ship under way
 * or another vehicle moving keeps the answer. Approximations: the original's dock command takes any
 * point, so a click at sea also moors when a ring node takes it; the probe accepts walkable land only,
 * the shore the crew can step onto; and other vehicles do not dim a shore, whether one lies on its
 * ring or across the only way there, where the order then finds no route.
 */
export function mooringProbe(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): MooringProbe | null {
  return mooringMemoOf(world, ctx, terrain, vehicle)?.probe ?? null;
}

/** The spot set behind {@link mooringProbe}, from the same memo. */
export function mooringSpotsOf(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): MooringSpots | null {
  return mooringMemoOf(world, ctx, terrain, vehicle);
}

function mooringMemoOf(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): MooringMemo | null {
  const state = world.tryGet(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  if (state === undefined || anchor === null || state.carrier !== null) return null;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  const vector = type?.passengerVector;
  if (type === undefined || vector === undefined || !isShipVehicle(type)) return null;
  if (!terrain.inBounds(anchor.hx, anchor.hy)) return null;
  const regions = seaRegions(world, ctx, terrain, type.logicSize);
  const reach = regions.regionsFrom(terrain.nodeAt(anchor.hx, anchor.hy));
  const key = `${regions.key}:${reach.join(',')}:${vector.distance}`;
  const cached = mooringMemo.get(world);
  if (cached !== undefined && cached.key === key && cached.terrain === terrain) return cached;
  const spots = mooringSpots(world, ctx, terrain, regions, reach, vector.distance);
  const probe: MooringProbe = {
    key,
    canMoor: (x, y) => terrain.inBounds(x, y) && spots.has(terrain.nodeAt(x, y)),
  };
  const memo: MooringMemo = { key, spots, terrain, probe };
  mooringMemo.set(world, memo);
  return memo;
}

/**
 * The walkable land nodes from `doorDistance` to {@link DOCK_RING_SLACK} rings beyond it away from a node
 * of the `reach` regions, the rings {@link dockCandidates} searches. A node whose free-size class is at
 * least the outermost ring has no other continent within it (the class is the radius of its own open
 * component around it), so only the coastal band is scanned.
 */
function mooringSpots(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  regions: SeaRegions,
  reach: readonly number[],
  doorDistance: number,
): ReadonlySet<NodeId> {
  const clearance = vehicleClearance(world, ctx, terrain);
  const outermost = doorDistance + DOCK_RING_SLACK;
  const inland = outermost <= MAX_CLEARANCE_CLASS ? outermost : Number.POSITIVE_INFINITY;
  const spots = new Set<NodeId>();
  for (let n = 0; n < terrain.nodeCount; n++) {
    const node = n as NodeId;
    if (!reach.includes(regions.regionOf(node)) || clearance.classOf(node) >= inland) continue;
    const { x, y } = terrain.coordsOf(node);
    for (let radius = doorDistance; radius <= outermost; radius++) {
      for (const { point } of hexagonRing({ hx: x, hy: y }, radius)) {
        if (!terrain.inBounds(point.hx, point.hy)) continue;
        const shore = terrain.nodeAt(point.hx, point.hy);
        if (terrain.isWalkable(shore)) spots.add(shore);
      }
    }
  }
  return spots;
}
