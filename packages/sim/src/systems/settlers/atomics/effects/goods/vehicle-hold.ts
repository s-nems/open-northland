import { CargoRun, Carrying, Vehicle, VehicleStock } from '../../../../../components/index.js';
import { contentIndex } from '../../../../../core/content-index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import {
  modifyVehicleReserved,
  modifyVehicleStock,
  vehicleIsFull,
  vehicleStockGood,
} from '../../../../vehicles/stock.js';
import { addCarry, shrinkCarry } from './carry.js';

/**
 * Resolve one completed `vehicleLoad`: the unit on the carrier's back goes into the hold when the hold
 * still wants what is booked (`reserved <= wanted`) and is not full (the original's arrival test), else
 * the booking is dropped and the unit stays on the back for the delivery rung. The booking is spent
 * either way. Returns whether a unit went in.
 */
export function loadVehicleHold(world: World, ctx: SystemContext, carrier: Entity, vehicle: Entity): boolean {
  const run = world.tryGet(carrier, CargoRun);
  const load = world.tryGet(carrier, Carrying);
  if (run !== undefined) world.remove(carrier, CargoRun);
  if (run === undefined || run.vehicle !== vehicle || run.direction !== 'load') return false;
  const state = world.tryGet(vehicle, Vehicle);
  const stock = world.tryGet(vehicle, VehicleStock);
  if (state === undefined || stock === undefined) return false;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return false;
  const line = stock.lines.get(run.goodType);
  const takes =
    load !== undefined &&
    load.amount > 0 &&
    vehicleStockGood(ctx.content, type, load.goodType) === run.goodType &&
    line !== undefined &&
    line.reserved <= line.wanted &&
    !vehicleIsFull(type, stock);
  if (!takes || load === undefined) {
    modifyVehicleReserved(world, vehicle, ctx.content, run.goodType, -1);
    return false;
  }
  if (modifyVehicleStock(world, vehicle, ctx.content, load.goodType, 1) !== 1) {
    modifyVehicleReserved(world, vehicle, ctx.content, run.goodType, -1);
    return false;
  }
  shrinkCarry(world, carrier, world.mut(carrier, Carrying), 1);
  return true;
}

/**
 * Resolve one completed `vehicleUnload`: one unit of `goodType` leaves the hold for the carrier's back.
 * The booking was already dropped when the carrier set out, so a line emptied meanwhile yields nothing
 * and the hold keeps the lower booking, as the original's flush does.
 */
export function unloadVehicleHold(
  world: World,
  ctx: SystemContext,
  carrier: Entity,
  vehicle: Entity,
  goodType: number,
): void {
  const run = world.tryGet(carrier, CargoRun);
  if (run !== undefined) world.remove(carrier, CargoRun);
  if (run === undefined || run.vehicle !== vehicle || run.direction !== 'unload') return;
  const held = world.tryGet(carrier, Carrying);
  if (held !== undefined && held.amount > 0 && held.goodType !== goodType) return; // hands full of another good
  if (modifyVehicleStock(world, vehicle, ctx.content, goodType, -1) !== -1) return;
  addCarry(world, carrier, goodType, 1);
}
