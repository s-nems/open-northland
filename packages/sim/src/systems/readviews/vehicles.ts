import type { ContentSet, VehicleType } from '@open-northland/data';
import { Rider, Settler, Vehicle } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { Traversal } from '../../nav/terrain/index.js';

/**
 * A ship or boat rather than a land cart or siege engine, keyed on `vehicletypes.ini` `passengerslots`
 * because it is the semantic "carries people" param rather than a graphics footprint. Only the two ships
 * carry passengers; every cart and the catapult list 0.
 */
export function isShipVehicle(vehicle: VehicleType): boolean {
  return vehicle.passengerSlots > 0;
}

/** Whether `e` is attached to a ship, whose riders' needs run on aboard (a cart's stand still). */
export function isAboardShip(world: World, content: ContentSet, e: Entity): boolean {
  const rider = world.tryGet(e, Rider);
  if (rider === undefined || !world.has(e, Settler)) return false;
  const state = world.tryGet(rider.vehicle, Vehicle);
  const type = state === undefined ? undefined : contentIndex(content).vehicles.get(state.vehicleType);
  return type !== undefined && isShipVehicle(type);
}

/** The ground a vehicle moves over: ships sail the water bodies, every other vehicle drives the land. */
export function vehicleTraversal(vehicle: VehicleType): Traversal {
  return isShipVehicle(vehicle) ? 'water' : 'land';
}

/**
 * A siege engine: the land vehicle with no hold, which is the catapult. The original keys the catapult's
 * doubled move period on its type id; the hold-less row is the same vehicle read from the data.
 */
export function isSiegeVehicle(vehicle: VehicleType): boolean {
  return !isShipVehicle(vehicle) && vehicle.stockSlots === 0;
}

/**
 * A warship rather than a trade ship: a ship whose `logicpassenger` list admits a siege engine. Of the two
 * ships only the small one carries the catapult; the big one is the merchant hull.
 */
export function isWarship(content: ContentSet, vehicle: VehicleType): boolean {
  let held = warships.get(vehicle);
  if (held === undefined) {
    const siegeJobs = new Set<number>();
    for (const type of contentIndex(content).vehicles.values())
      if (isSiegeVehicle(type)) siegeJobs.add(type.jobId);
    held = isShipVehicle(vehicle) && vehicle.passengerJobs.some((job) => siegeJobs.has(job));
    warships.set(vehicle, held);
  }
  return held;
}

/** Content-keyed: each vehicle row's {@link isWarship} answer. */
const warships = new WeakMap<VehicleType, boolean>();

/** Whether the vehicle still needs its draught animal: its type recruits one and none has arrived. Such a
 *  vehicle waits under `waitsForAnimal` and refuses a goto with `vehicleNoAnimal`. */
export function awaitsDraughtAnimal(vehicle: VehicleType, state: { readonly harnessed: boolean }): boolean {
  return vehicle.draggingAnimalTribe !== undefined && !state.harnessed;
}

/**
 * The `vehicle`-kind house a workshop raises to make `goodType`, or undefined for an ordinary ware. A
 * vehicle good is never crafted as a recipe cycle or shelved: its production is a hidden construction
 * site of this house beside the workshop (docs/formats/VEHICLES.md "Construction").
 */
export function vehicleHouseOfGood(content: ContentSet, goodType: number): number | undefined {
  return contentIndex(content).goods.get(goodType)?.vehicleHouse;
}
