import type { VehicleType } from '@open-northland/data';
import {
  commanderSlotOf,
  Health,
  Position,
  stampMissionId,
  stampOwner,
  VEHICLE_SPAWN_FACING,
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
import { hexDisc, vehicleBlockedCells } from '../footprint/index.js';
import { vehicleClearance } from '../footprint/vehicle-clearance.js';
import { awaitsDraughtAnimal, isShipVehicle } from '../readviews/vehicles.js';
import { NO_REGION, seaRegions } from './sea-regions.js';
import { stockVehicleGoods } from './stock.js';

function emptySeats(count: number): (VehicleSeat | null)[] {
  return new Array<VehicleSeat | null>(count).fill(null);
}

/** The first walkable node on the hexagon rings round `anchor` out to `maxRing`, in ring order, with its ring. */
function nearestShore(
  terrain: TerrainGraph,
  anchor: HalfCellNode,
  maxRing: number,
): { readonly point: HalfCellNode; readonly ring: number } | null {
  for (let ring = 1; ring <= maxRing; ring++) {
    for (const { point } of hexagonRing(anchor, ring)) {
      if (terrain.inBounds(point.hx, point.hy) && terrain.isWalkable(terrain.nodeAt(point.hx, point.hy))) {
        return { point, ring };
      }
    }
  }
  return null;
}

/**
 * The shore node a ship lying at `anchor` is moored to: the nearest walkable node out to the door
 * distance. Null when open water surrounds the ship. Approximation: the original searches the ring at
 * exactly the door distance for land (`docs/formats/VEHICLES.md`, "Ships and docking").
 */
function spawnMooring(terrain: TerrainGraph, type: VehicleType, anchor: HalfCellNode): HalfCellNode | null {
  const vector = type.passengerVector;
  return vector === undefined ? null : (nearestShore(terrain, anchor, vector.distance)?.point ?? null);
}

/** How far a berthed spawn looks for its berth, in door distances of the ship from the clicked node. */
const BERTH_SEARCH_DOOR_DISTANCES = 3;

/**
 * The node nearest `click`, in ring order out to {@link BERTH_SEARCH_DOOR_DISTANCES} door distances, a
 * ship of `type` may lie on moored: water its free-size class holds the disc on, no other vehicle on
 * that disc, and the nearest walkable land at exactly the door distance, as a dock node needs. Null when
 * none is in reach.
 */
function berthNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  type: VehicleType,
  click: HalfCellNode,
): HalfCellNode | null {
  const vector = type.passengerVector;
  if (vector === undefined) return null;
  const regions = seaRegions(world, ctx, terrain, type.logicSize);
  const clearance = vehicleClearance(world, ctx, terrain);
  const vehicles = vehicleBlockedCells(world, ctx, terrain);
  const open = (point: HalfCellNode): boolean =>
    terrain.inBounds(point.hx, point.hy) && (vehicles.get(terrain.nodeAt(point.hx, point.hy)) ?? 0) === 0;
  for (let r = 0; r <= vector.distance * BERTH_SEARCH_DOOR_DISTANCES; r++) {
    for (const { point } of hexagonRing(click, r)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const node = terrain.nodeAt(point.hx, point.hy);
      if (regions.regionOf(node) === NO_REGION || clearance.classOf(node) < type.logicSize) continue;
      if (!hexDisc(point, type.logicSize).every(open)) continue;
      if (nearestShore(terrain, point, vector.distance)?.ring === vector.distance) return point;
    }
  }
  return null;
}

/**
 * Put a vehicle on the map - see the command doc. Returns the entity, or null for a type the content
 * lacks or a berthed ship with no berth in reach. Authored scenes call it directly; the command path
 * goes through it.
 */
export function createVehicle(
  world: World,
  ctx: SystemContext,
  spec: Omit<CreateVehicleCommand, 'kind'>,
): Entity | null {
  const type = contentIndex(ctx.content).vehicles.get(spec.vehicleType);
  if (type === undefined) return null;
  const terrain = isShipVehicle(type) ? ctx.terrain : undefined;
  const clicked = { hx: spec.x, hy: spec.y };
  const anchor =
    spec.berth === true && terrain !== undefined ? berthNode(world, ctx, terrain, type, clicked) : clicked;
  if (anchor === null) return null;
  const mooring = terrain !== undefined ? spawnMooring(terrain, type, anchor) : null;
  const e = world.create();
  world.add(e, Position, positionOfNode(anchor.hx, anchor.hy));
  world.add(e, Vehicle, {
    vehicleType: type.typeId,
    tribe: spec.tribe,
    task: awaitsDraughtAnimal(type, { harnessed: false }) ? 'waitsForAnimal' : 'none',
    facing: VEHICLE_SPAWN_FACING,
    moored: mooring !== null,
    mooring,
    harnessed: false,
    carrier: null,
    hauler: null,
    passengers: emptySeats(commanderSlotOf(type.passengerSlots) + 1),
    vehicles: emptySeats(type.vehicleSlots),
    heldGoal: null,
    heldDock: null,
    stance: 'hold',
    guard: { hx: anchor.hx, hy: anchor.hy },
    attack: null,
    attackClipStart: null,
    march: null,
  });
  world.add(e, Health, { hitpoints: type.hitpoints, max: type.hitpoints });
  world.add(e, VehicleStock, { lines: new Map() });
  stampOwner(world, e, spec.owner);
  stampMissionId(world, e, spec.missionId);
  for (const entry of spec.goods ?? []) stockVehicleGoods(world, e, ctx.content, entry.good, entry.amount);
  ctx.events.emit({ kind: 'vehicleCreated', entity: e, vehicleType: type.typeId, at: anchor });
  return e;
}
