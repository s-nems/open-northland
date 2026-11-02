import type { AiOrderOrigin } from '../../components/ai/order.js';
import { ownerOf, Position, Rider, Vehicle, vehicleCommander } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { turnToVehicle } from './crew.js';
import { moveVehicle } from './movement.js';
import { queueVehicleOrder } from './order-queue.js';
import type { VehicleOrderRoutes } from './order-routes.js';

// A vehicle's commander drives it: a walk order given to the commander goes to the vehicle, whether the
// commander is aboard or stands beside it. A commander aboard a moored ship walks ashore instead.

/** The vehicle `e` commands and that stands on the map: the vehicle its `Rider` names when `e` holds the
 *  commander seat. Null for an ordinary passenger, a rider aboard a moored ship, a carried vehicle,
 *  or a vehicle a script handed to another player while its commander kept its own owner. */
export function commandedVehicleOf(world: World, e: Entity): Entity | null {
  const rider = world.tryGet(e, Rider);
  if (rider === undefined) return null;
  const state = world.tryGet(rider.vehicle, Vehicle);
  if (
    state === undefined ||
    vehicleCommander(state) !== e ||
    state.carrier !== null ||
    (state.moored && !world.has(e, Position))
  )
    return null;
  if (ownerOf(world, rider.vehicle) !== ownerOf(world, e)) return null;
  return vehicleAnchor(world, rider.vehicle) === null ? null : rider.vehicle;
}

/** The walk orders a commander hands to its vehicle. */
export function isCommanderWalkOrder(
  command: Command,
): command is Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }> {
  return command.kind === 'moveUnit' || command.kind === 'attackMoveUnit';
}

/**
 * Give a commander's walk order to its vehicle as a goto (`moveVehicle`, with its refusals), an
 * attack-move as the goto's march: the crew boards first through the goto's `waitsForHuman` hold, and a
 * commander outside turns to the door ({@link turnToVehicle}), the rider rung taking it from there.
 * False when `e` commands no vehicle, leaving the order to the ordinary walk.
 */
export function driveCommandedVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>,
  orders?: VehicleOrderRoutes,
  origin?: AiOrderOrigin,
): boolean {
  const e = command.entity;
  const vehicle = commandedVehicleOf(world, e);
  if (vehicle === null) return false;
  const attackMove = command.kind === 'attackMoveUnit';
  const goto = { kind: 'moveVehicle', vehicle, x: command.x, y: command.y, attackMove } as const;
  // A Shift-clicked walk waits behind the vehicle's current order, the commander's own doings untouched.
  if (command.queued === true && queueVehicleOrder(world, { ...goto, queued: true }, origin)) return true;
  if (!moveVehicle(world, ctx, goto, orders, origin)) {
    return true;
  }
  turnToVehicle(world, e);
  return true;
}
