import type { ContentSet, VehicleType } from '@open-northland/data';
import { Position, VEHICLE_FACINGS, Vehicle, type VehicleStateView } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import {
  type HalfCellNode,
  HEX_DIRECTIONS,
  hexagonRing,
  nodeOfPosition,
  stepHex,
} from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

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
 * The door point: a moored ship's mooring node on the shore; otherwise `passengerVector` walked from
 * the anchor in the direction `facing + direction` (modulo the six map-point directions), which is the
 * anchor itself for a cart or catapult that authors no vector. Unclamped; null for a positionless
 * vehicle.
 */
export function vehicleDoorPoint(
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

export function vehicleDoorNode(world: World, content: ContentSet, e: Entity): HalfCellNode | null {
  const vehicle = world.tryGet(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (vehicle === undefined || anchor === null) return null;
  const type = contentIndex(content).vehicles.get(vehicle.vehicleType);
  return type === undefined ? null : vehicleDoorPoint(vehicle, type, anchor);
}
