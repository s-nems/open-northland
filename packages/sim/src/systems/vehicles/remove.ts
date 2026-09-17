import {
  carriedVehicles,
  type GoodsLine,
  Owner,
  Position,
  Vehicle,
  VehicleStock,
  vehiclePassengers,
  vehicleStockEntries,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { type SpilledStock, scatterSpilledStock } from '../economy/goods-spill.js';
import { vehicleAnchor, vehicleDoorPoint, vehicleFootprintNodes } from '../footprint/index.js';
import { reap } from '../lifecycle/cleanup.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { vehicleIndex } from './registry.js';

/** How far a wrecked cart's or catapult's cargo scatters, in spill rings (byte-verified radius 10;
 *  approximation: the ring metric is the spill's Manhattan ring, not the hexagon). */
export const VEHICLE_CARGO_SPILL_RADIUS = 10;

/** The share of footprint nodes a wreck marks with ruins, in percent (byte-verified). */
export const VEHICLE_RUIN_PERCENT = 51;
const PERCENT = 100;

/** Why a vehicle leaves the map: its pool ran out, its seat died, or a script took it away. */
export type VehicleRemovalCause = 'destroyed' | 'defeated' | 'script';

/**
 * Take a vehicle off the map (docs/formats/VEHICLES.md "Lifecycle"): its passengers step onto the door
 * node when that is land, otherwise they die with it; a carried vehicle goes the same way first; a cart
 * or catapult heaps its cargo around it and draws ruins on {@link VEHICLE_RUIN_PERCENT} of its footprint
 * through the seeded RNG; a ship leaves nothing. The event goes out before the destroy so the owner and
 * position are still readable.
 */
export function removeVehicle(world: World, ctx: SystemContext, e: Entity, cause: VehicleRemovalCause): void {
  const vehicle = world.tryGet(e, Vehicle);
  if (vehicle === undefined) return;
  const type = contentIndex(ctx.content).vehicles.get(vehicle.vehicleType);
  const anchor = vehicleAnchor(world, e);
  const door = type !== undefined && anchor !== null ? vehicleDoorPoint(vehicle, type, anchor) : null;
  const landing = door !== null && isLand(ctx, door) ? door : null;

  for (const seat of carriedVehicles(vehicle)) removeVehicle(world, ctx, seat.entity, cause);
  for (const seat of vehiclePassengers(vehicle)) {
    if (!world.isAlive(seat.entity)) continue;
    if (landing === null) reap(world, ctx, seat.entity);
    else setDown(world, seat.entity, landing);
  }

  const wrecks = type !== undefined && !isShipVehicle(type);
  const spill = wrecks ? cargoSpillOf(world, e, anchor) : null;
  const ruins = wrecks && ctx.terrain !== undefined ? drawRuins(world, ctx, e) : [];
  const player = world.tryGet(e, Owner)?.player ?? null;
  ctx.events.emit({
    kind: 'vehicleDestroyed',
    entity: e,
    player,
    vehicleType: vehicle.vehicleType,
    tribe: vehicle.tribe,
    cause,
    ...(anchor !== null ? { at: anchor } : {}),
    ruins,
  });
  world.destroy(e);
  scatterSpilledStock(world, ctx, spill);
}

/** Remove every vehicle `player` owns, in ascending entity order. The list is copied because every
 *  removal rebuilds the index it came from. */
export function removeVehiclesOf(world: World, ctx: SystemContext, player: number): void {
  for (const e of [...vehicleIndex(world).ownedBy(player)]) {
    if (world.isAlive(e)) removeVehicle(world, ctx, e, 'defeated');
  }
}

/** Whether a settler can stand at `point`: on the map and walkable, which excludes open water. */
function isLand(ctx: SystemContext, point: HalfCellNode): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return true; // a mapless sim has no sea to drown in
  return terrain.inBounds(point.hx, point.hy) && terrain.isWalkable(terrain.nodeAt(point.hx, point.hy));
}

/** Put a freed rider on the map at `point`, restoring the Position a boarded rider gave up. */
function setDown(world: World, rider: Entity, point: HalfCellNode): void {
  const at = positionOfNode(point.hx, point.hy);
  const pos = world.tryMut(rider, Position);
  if (pos === undefined) world.add(rider, Position, at);
  else {
    pos.x = at.x;
    pos.y = at.y;
  }
}

function cargoSpillOf(world: World, e: Entity, anchor: HalfCellNode | null): SpilledStock | null {
  const stock = world.tryGet(e, VehicleStock);
  if (stock === undefined || anchor === null) return null;
  const goods: GoodsLine[] = [];
  for (const [goodType, line] of vehicleStockEntries(stock)) {
    if (line.current > 0) goods.push({ goodType, amount: line.current });
  }
  if (goods.length === 0) return null;
  const at = positionOfNode(anchor.hx, anchor.hy);
  return { x: at.x, y: at.y, goods, maxRadius: VEHICLE_CARGO_SPILL_RADIUS };
}

/** One RNG draw per footprint node in ring order, so the wreck pattern replays with the seed. */
function drawRuins(world: World, ctx: SystemContext, e: Entity): HalfCellNode[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const ruins: HalfCellNode[] = [];
  for (const node of vehicleFootprintNodes(world, ctx.content, terrain, e)) {
    if (ctx.rng.int(PERCENT) < VEHICLE_RUIN_PERCENT) {
      const { x, y } = terrain.coordsOf(node);
      ruins.push({ hx: x, hy: y });
    }
  }
  return ruins;
}
