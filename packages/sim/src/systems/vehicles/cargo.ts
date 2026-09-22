import { CargoRun, Vehicle, VehicleStock } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { refuseCrew } from './crew.js';
import { clearVehicleWanted, hasCarrierAttached, setVehicleWanted } from './stock.js';

// The wanted-amount orders of docs/formats/VEHICLES.md "Cargo", and the booking a carrier holds on a
// hold while it walks; the carrier's own rung lives in `settlers/drives/economy/vehicle-cargo.ts`.

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

/** Both orders tell the player when nobody is attached to carry them out. */
function noteMissingCarrier(world: World, ctx: SystemContext, vehicle: Entity): void {
  if (!hasCarrierAttached(world, ctx.content, vehicle)) refuseCrew(world, ctx, vehicle, 'noCarrier');
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
