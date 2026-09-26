import { CargoRun, Position, Rider, Vehicle, VehicleDrive, VehicleStock } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { isShipAtSea, landingOf, refuseCrew, setDownRider } from './crew.js';
import { cargoHandHasWork, clearVehicleWanted, hasCargoHand, setVehicleWanted } from './stock.js';

// The wanted-amount orders of docs/formats/VEHICLES.md "Cargo", the booking a cargo hand holds on a hold
// while it walks, and the hand stepping out to work; its rung lives in
// `settlers/drives/economy/vehicle-cargo.ts`.

/** The `setVehicleWanted` order - see the command doc. */
export function setVehicleWantedOrder(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setVehicleWanted' }>,
): void {
  const { vehicle, goodType, amount } = command;
  if (!world.has(vehicle, Vehicle)) return;
  if (!setVehicleWanted(world, vehicle, ctx.content, goodType, amount)) return;
  noteMissingCarrier(world, ctx, vehicle);
}

/** The `clearVehicleWanted` order - see the command doc. */
export function clearVehicleWantedOrder(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'clearVehicleWanted' }>,
): void {
  const vehicle = command.vehicle;
  if (!world.has(vehicle, Vehicle)) return;
  clearVehicleWanted(world, vehicle);
  noteMissingCarrier(world, ctx, vehicle);
}

/** Both orders tell the player when nobody is seated to carry them out. */
function noteMissingCarrier(world: World, ctx: SystemContext, vehicle: Entity): void {
  if (!hasCargoHand(world, ctx.content, vehicle)) refuseCrew(world, ctx, vehicle, 'noCarrier');
}

/**
 * Drop a carrier's booking: a `load` run gives its unit back to the hold's free budget, an `unload` run
 * books its unit again, so a carrier that leaves, dies or is re-tasked mid-walk leaves `reserved` as if it
 * had never set out, as in the original. The unit on its back stays there.
 */
export function abandonCargoRun(world: World, carrier: Entity): void {
  const run = world.tryGet(carrier, CargoRun);
  if (run === undefined) return;
  world.remove(carrier, CargoRun);
  const stock = world.tryGet(run.vehicle, VehicleStock);
  const line = stock?.lines.get(run.goodType);
  if (line === undefined) return;
  const delta = run.direction === 'load' ? -1 : 1;
  if (line.reserved + delta < 0) return;
  const live = world.mut(run.vehicle, VehicleStock).lines.get(run.goodType);
  if (live !== undefined) live.reserved += delta;
}

/**
 * A cargo hand riding inside a vehicle that stands still, a cart with no drive or held goal or a moored
 * ship, steps out onto the door while the hold has a trip for it, so a ship's crew unloads at the shore
 * and a trader's cart loads beside a house without a carrier (owner's choice; the original's carrier
 * works only from outside). A commander lets a request nobody can fill lapse. Before the planner, so
 * the hand is planned the tick it lands.
 */
export const cargoHandDisembarkSystem: System = (world, ctx) => {
  for (const e of world.canonicalQuery(Rider)) {
    if (world.has(e, Position)) continue;
    const vehicle = world.get(e, Rider).vehicle;
    const state = world.tryGet(vehicle, Vehicle);
    if (state === undefined || state.carrier !== null || state.heldGoal !== null) continue;
    if (world.has(vehicle, VehicleDrive) || isShipAtSea(ctx, state)) continue;
    if (!cargoHandHasWork(world, ctx.content, vehicle, e)) continue;
    const landing = landingOf(world, ctx, vehicle);
    if (landing !== null) setDownRider(world, e, landing);
  }
};
