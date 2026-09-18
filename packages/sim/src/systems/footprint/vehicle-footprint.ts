import type { ContentSet, VehicleType } from '@open-northland/data';
import { Position, VEHICLE_FACINGS, Vehicle, type VehicleStateView } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import {
  type HalfCellNode,
  HEX_DIRECTIONS,
  hexagonRing,
  hexDistance,
  nodeOfPosition,
  stepHex,
} from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext } from '../context.js';

// A vehicle's ground geometry: the hex disc of radius `logicSize` it occupies and the door point its
// crew boards and leaves at (byte-verified rules in docs/formats/VEHICLES.md). Pure over the component
// and the type row; the walk-block and placement caches consume it.

/** The map points within `radius` hexagon steps of `centre`, unclamped, in ring order from the centre
 *  outward: a set union and a pick both read it, and the ring order is the original's. */
export function hexDisc(centre: HalfCellNode, radius: number): HalfCellNode[] {
  const points: HalfCellNode[] = [];
  for (let r = 0; r <= radius; r++) {
    for (const { point } of hexagonRing(centre, r)) points.push(point);
  }
  return points;
}

/** The vehicle's anchor node, or null once it rides a carrier and stands nowhere. */
export function vehicleAnchor(world: World, e: Entity): HalfCellNode | null {
  const p = world.tryGet(e, Position);
  return p === undefined ? null : nodeOfPosition(p.x, p.y);
}

/** The disc a standing vehicle covers, clamped to the map; empty for a positionless one. */
export function vehicleFootprintNodes(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  e: Entity,
): NodeId[] {
  const vehicle = world.tryGet(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (vehicle === undefined || anchor === null) return [];
  const type = contentIndex(content).vehicles.get(vehicle.vehicleType);
  if (type === undefined) return [];
  const nodes: NodeId[] = [];
  for (const { hx, hy } of hexDisc(anchor, type.logicSize)) {
    if (terrain.inBounds(hx, hy)) nodes.push(terrain.nodeAt(hx, hy));
  }
  return nodes;
}

/**
 * The authored entry point (`Door_GetEntryPoint`): a moored ship's mooring node on the shore; otherwise
 * `passengerVector` walked from the anchor in the direction `facing + direction` (modulo the six
 * map-point directions), which is the anchor itself for a cart or catapult that authors no vector.
 * Unclamped.
 */
export function vehicleEntryPoint(
  vehicle: VehicleStateView,
  type: VehicleType,
  anchor: HalfCellNode,
): HalfCellNode {
  if (vehicle.moored && vehicle.mooring !== null) return { hx: vehicle.mooring.hx, hy: vehicle.mooring.hy };
  const vector = type.passengerVector;
  if (vector === undefined) return anchor;
  const direction = HEX_DIRECTIONS[(vehicle.facing + vector.direction) % VEHICLE_FACINGS];
  if (direction === undefined) return anchor;
  let at = anchor;
  for (let i = 0; i < vector.distance; i++) at = stepHex(at, direction);
  return at;
}

/**
 * The door point the crew and the cargo hands stand on. The original's humans walk through a vehicle,
 * so its entry point may lie on the vehicle itself, and `Door_GetEntryPoint` only moves on to the ring
 * around it when that point is blocked. Open Northland blocks a standing vehicle's disc for humans
 * (approximation), so an entry point inside the disc always takes that fallback: the first open ground
 * node on the anchor's continent around the ring just outside the disc, tested in the original's order
 * (it steps before it tests, so the north-east node comes first and the north-west start last).
 * Without a terrain, or with no such node, the entry point stands. Unclamped.
 */
export function vehicleDoorPoint(
  vehicle: VehicleStateView,
  type: VehicleType,
  anchor: HalfCellNode,
  terrain: TerrainGraph | undefined,
): HalfCellNode {
  const entry = vehicleEntryPoint(vehicle, type, anchor);
  if (vehicle.moored && vehicle.mooring !== null) return entry; // the shore, never the ship's disc
  if (terrain === undefined || hexDistance(entry, anchor) > type.logicSize) return entry;
  if (!terrain.inBounds(anchor.hx, anchor.hy)) return entry;
  const continent = terrain.componentOf(terrain.nodeAt(anchor.hx, anchor.hy));
  const ring = Array.from(hexagonRing(anchor, type.logicSize + 1), ({ point }) => point);
  const start = ring.shift();
  if (start !== undefined) ring.push(start);
  for (const point of ring) {
    if (!terrain.inBounds(point.hx, point.hy)) continue;
    const node = terrain.nodeAt(point.hx, point.hy);
    if (terrain.isWalkable(node) && terrain.componentOf(node) === continent) return point;
  }
  return entry;
}

export function vehicleDoorNode(world: World, ctx: MapContext, e: Entity): HalfCellNode | null {
  const vehicle = world.tryGet(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (vehicle === undefined || anchor === null) return null;
  const type = contentIndex(ctx.content).vehicles.get(vehicle.vehicleType);
  return type === undefined ? null : vehicleDoorPoint(vehicle, type, anchor, ctx.terrain);
}
