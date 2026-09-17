import type { VehicleType } from '@open-northland/data';
import {
  commanderSlotOf,
  Health,
  Position,
  stampMissionId,
  stampOwner,
  Vehicle,
  type VehicleSeat,
  VehicleStock,
} from '../../components/index.js';
import type { CreateVehicleCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexagonRing, positionOfNode } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isShipVehicle } from '../readviews/vehicles.js';

/** The facing a fresh vehicle takes. Approximation: neither `setvehicle` nor a yard authors one. */
const SPAWN_FACING = 0;

function emptySeats(count: number): (VehicleSeat | null)[] {
  return new Array<VehicleSeat | null>(count).fill(null);
}

/**
 * The shore node a ship lying at `anchor` is moored to: the first walkable node on the hexagon rings
 * out to the door distance, in ring order (the original's spawn test is "a land continent borders it
 * within `passengervector[1]` steps"; which node it stores is not read, so the nearest in ring order is
 * the named pick). Null when open water surrounds the ship.
 */
function spawnMooring(terrain: TerrainGraph, type: VehicleType, anchor: HalfCellNode): HalfCellNode | null {
  const vector = type.passengerVector;
  if (vector === undefined) return null;
  for (let r = 1; r <= vector.distance; r++) {
    for (const { point } of hexagonRing(anchor, r)) {
      if (terrain.inBounds(point.hx, point.hy) && terrain.isWalkable(terrain.nodeAt(point.hx, point.hy))) {
        return point;
      }
    }
  }
  return null;
}

/**
 * Put a vehicle on the map - see the command doc. Returns the entity, or null for a type the content
 * lacks. Authored scenes call it directly; the command path goes through it.
 */
export function createVehicle(
  world: World,
  ctx: SystemContext,
  spec: Omit<CreateVehicleCommand, 'kind'>,
): Entity | null {
  const type = contentIndex(ctx.content).vehicles.get(spec.vehicleType);
  if (type === undefined) return null;
  const anchor = { hx: spec.x, hy: spec.y };
  const mooring =
    ctx.terrain !== undefined && isShipVehicle(type) ? spawnMooring(ctx.terrain, type, anchor) : null;
  const e = world.create();
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Vehicle, {
    vehicleType: type.typeId,
    tribe: spec.tribe,
    task: 'none',
    facing: SPAWN_FACING,
    moored: mooring !== null,
    mooring,
    harnessed: false,
    carrier: null,
    passengers: emptySeats(commanderSlotOf(type.passengerSlots) + 1),
    vehicles: emptySeats(type.vehicleSlots),
  });
  world.add(e, Health, { hitpoints: type.hitpoints, max: type.hitpoints });
  world.add(e, VehicleStock, { lines: new Map() });
  stampOwner(world, e, spec.owner);
  stampMissionId(world, e, spec.missionId);
  ctx.events.emit({ kind: 'vehicleCreated', entity: e, vehicleType: type.typeId, at: anchor });
  return e;
}
