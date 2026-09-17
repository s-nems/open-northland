import { type DeepReadonly, defineComponent, type Entity, type World } from '../ecs/world.js';
import type { HalfCellNode } from '../nav/halfcell.js';
import { Position } from './movement.js';

/** The tasks the original's vehicle window shows, in its numbering 0..6. */
export const VEHICLE_TASKS = [
  'none',
  'docks',
  'attacks',
  'waitsForHuman',
  'waitsForAnimal',
  'interrupted',
  'boardsShip',
] as const;
export type VehicleTask = (typeof VEHICLE_TASKS)[number];

/** The six map-point directions a vehicle faces, indexing `nav/halfcell.ts`'s `HEX_DIRECTIONS`.
 *  Approximation: the original's facing count for vehicles is not read; the door offset is a hexagon
 *  direction, so the facing is kept in the same space. */
export const VEHICLE_FACINGS = 6;

/** One occupied slot: who holds it, and whether the rider is aboard (off the map) rather than still
 *  walking to the door. */
export interface VehicleSeat {
  entity: Entity;
  inside: boolean;
}

/**
 * A cart, ship or catapult: one movable entity class, as in the original. Beside it ride `Position`
 * (the anchor node), `Health` (the type's pool), `VehicleStock`, `Owner` and an optional
 * `MissionObjectId`. `passengers` is `passengerSlots + 1` long with the commander in the last slot;
 * `vehicles` is `vehicleSlots` long. A null slot is free.
 */
export const Vehicle = defineComponent<{
  vehicleType: number;
  tribe: number;
  task: VehicleTask;
  facing: number;
  /** A ship lying at a shore; its door is then `mooring`, the shore node it docked at. */
  moored: boolean;
  mooring: HalfCellNode | null;
  /** An ox cart whose animal has arrived. */
  harnessed: boolean;
  /** The ship carrying this vehicle, or null while it stands on the map. */
  carrier: Entity | null;
  passengers: (VehicleSeat | null)[];
  vehicles: (VehicleSeat | null)[];
  /** A goto the vehicle holds while it boards its crew; the drive starts once everyone is inside. */
  heldGoal: HalfCellNode | null;
}>('Vehicle', 'movement');

/**
 * A settler attached to a vehicle, from the attach order until it is detached. The seat it holds says
 * whether it is inside; `boarding` is the vehicle's request to step in, which the rider answers on the
 * door node. An aboard rider has no `Position`: it stands nowhere on the map until it is set down.
 */
export const Rider = defineComponent<{ vehicle: Entity; boarding: boolean }>('Rider', 'movement');

/** Whether `e` is attached to a vehicle and inside it: off the map, owned by its seat. */
export function isAboardVehicle(world: World, e: Entity): boolean {
  return world.has(e, Rider) && !world.has(e, Position);
}

export type VehicleState = NonNullable<(typeof Vehicle)['__value']>;
export type VehicleStateView = DeepReadonly<VehicleState>;

/** A node crossing is complete at this much progress: the original's per-node counter reaches 10000. */
export const NODE_PROGRESS_FULL = 10000;

/**
 * A vehicle's drive to `goal`, the movement twin of a settler's `PathFollow`. `route` holds the nodes
 * still to enter, the next first; `Position` already stands on the node of the current leg, and `from`
 * is the node that leg left (null between legs), so the renderer interpolates from it to `Position` by
 * `progress / NODE_PROGRESS_FULL`. `increment` is the progress a tick adds, fixed when the leg starts.
 */
export const VehicleDrive = defineComponent<{
  goal: HalfCellNode;
  route: HalfCellNode[];
  from: HalfCellNode | null;
  progress: number;
  increment: number;
}>('VehicleDrive', 'movement');

/** Storage is a byte per allowed good in the original: current, wanted and reserved units. */
export interface VehicleStockLine {
  current: number;
  wanted: number;
  reserved: number;
}

/** A vehicle's hold: one line per canonical good it has ever been asked for; the type's `stockSlots`
 *  bounds the sum of `current` over every line. Never iterate for a decision; use
 *  {@link vehicleStockEntries}. */
export const VehicleStock = defineComponent<{ lines: Map<number, VehicleStockLine> }>(
  'VehicleStock',
  'economy',
);

/** The largest value a stock byte holds. */
export const VEHICLE_STOCK_BYTE_MAX = 255;

/** Canonical ascending-goodType view of a hold, empty lines included. */
export function vehicleStockEntries(stock: {
  lines: ReadonlyMap<number, DeepReadonly<VehicleStockLine>>;
}): Array<[number, DeepReadonly<VehicleStockLine>]> {
  return [...stock.lines.entries()].sort((a, b) => a[0] - b[0]);
}

/** Units aboard, summed over every good. */
export function vehicleLoad(stock: { lines: ReadonlyMap<number, DeepReadonly<VehicleStockLine>> }): number {
  let total = 0;
  for (const line of stock.lines.values()) total += line.current;
  return total;
}

/** The commander's slot index in a `passengers` array of this capacity. */
export function commanderSlotOf(passengerSlots: number): number {
  return passengerSlots;
}

/** The commander, the rider in the last passenger slot; null while nobody commands. */
export function vehicleCommander(vehicle: VehicleStateView): Entity | null {
  const slot = vehicle.passengers[vehicle.passengers.length - 1];
  return slot === undefined || slot === null ? null : slot.entity;
}

/** Every occupied passenger slot in slot order, the commander last. */
export function vehiclePassengers(vehicle: VehicleStateView): DeepReadonly<VehicleSeat>[] {
  return vehicle.passengers.filter((seat): seat is DeepReadonly<VehicleSeat> => seat !== null);
}

/** Every carried vehicle in slot order. */
export function carriedVehicles(vehicle: VehicleStateView): DeepReadonly<VehicleSeat>[] {
  return vehicle.vehicles.filter((seat): seat is DeepReadonly<VehicleSeat> => seat !== null);
}

/**
 * Seat `rider` on `vehicle`: the commander slot first, then the lowest free ordinary slot, the original's
 * attach order. False when every slot is taken; the caller has already checked the job gate.
 */
export function seatPassenger(world: World, vehicle: Entity, rider: Entity): boolean {
  const current = world.get(vehicle, Vehicle);
  const commander = commanderSlotOf(current.passengers.length - 1);
  let slot = current.passengers[commander] === null ? commander : -1;
  if (slot < 0) slot = current.passengers.findIndex((seat, i) => i !== commander && seat === null);
  if (slot < 0) return false;
  world.mut(vehicle, Vehicle).passengers[slot] = { entity: rider, inside: false };
  return true;
}

/** Mark `rider`'s seat inside or outside; false when the rider holds no seat. */
export function setSeatInside(world: World, vehicle: Entity, rider: Entity, inside: boolean): boolean {
  const slot = world
    .get(vehicle, Vehicle)
    .passengers.findIndex((seat) => seat !== null && seat.entity === rider);
  if (slot < 0) return false;
  const seat = world.mut(vehicle, Vehicle).passengers[slot];
  if (seat !== null && seat !== undefined) seat.inside = inside;
  return true;
}

/**
 * Free `rider`'s slot. A departing commander is replaced by the first ordinary passenger (the original
 * promotes the first remaining rider whose job the type allows; the caller applies that gate). False
 * when the rider was not aboard.
 */
export function unseatPassenger(world: World, vehicle: Entity, rider: Entity): boolean {
  const current = world.get(vehicle, Vehicle);
  const slot = current.passengers.findIndex((seat) => seat !== null && seat.entity === rider);
  if (slot < 0) return false;
  const commander = commanderSlotOf(current.passengers.length - 1);
  const live = world.mut(vehicle, Vehicle);
  live.passengers[slot] = null;
  if (slot !== commander) return true;
  const next = live.passengers.findIndex((seat, i) => i !== commander && seat !== null);
  if (next >= 0) {
    live.passengers[commander] = live.passengers[next] ?? null;
    live.passengers[next] = null;
  }
  return true;
}
