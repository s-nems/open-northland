import type { VehicleType } from '@open-northland/data';
import { Vehicle, vehicleCommander } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexagonRing } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { crewInside, moorVehicle, refuseMove, startVehicleDrive, vehicleWalkBlocks } from './movement.js';

// The dock order of docs/formats/VEHICLES.md "Ships and docking": a commanded ship boards its crew,
// scans the hexagon ring of its door distance around the clicked shore point for a node of its own
// water body it may lie at, sails there under the `docks` task with the click stored as its mooring
// point, and moors on arrival (`movement.ts`). No port building is involved.

/**
 * The nodes a ship may dock at for `point`, in the original's ring order: the map points at exactly
 * the door distance from the point that lie on the ship's own continent and are open under its
 * walk-block, which is the free-size class test plus the other vehicles' cells. The ship's own node
 * qualifies as an in-place mooring.
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
 * sail starts once everyone is inside (the original retries the order behind `l_Passengers_MoveIn`).
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
