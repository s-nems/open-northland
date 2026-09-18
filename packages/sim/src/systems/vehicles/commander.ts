import { PlayerOrder, Position, Rider, Vehicle, vehicleCommander } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { clearNavState } from '../movement/nav-state.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { moveVehicle } from './movement.js';

// A vehicle's commander drives it: a walk order given to the commander goes to the vehicle, whether the
// commander is aboard or stands beside it. Named deviation in docs/formats/VEHICLES.md "Crew": the
// original detaches the human first and walks him off alone, leaving the cart and its cargo behind.

/** The vehicle `e` commands and that stands on the map: the vehicle its `Rider` names when `e` holds the
 *  commander seat. Null for a settler on foot, an ordinary passenger, or a vehicle riding a carrier. */
export function commandedVehicleOf(world: World, e: Entity): Entity | null {
  const rider = world.tryGet(e, Rider);
  if (rider === undefined) return null;
  const state = world.tryGet(rider.vehicle, Vehicle);
  if (state === undefined || vehicleCommander(state) !== e || state.carrier !== null) return null;
  return vehicleAnchor(world, rider.vehicle) === null ? null : rider.vehicle;
}

/** The walk orders a commander hands to its vehicle. */
export function isCommanderWalkOrder(
  command: Command,
): command is Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }> {
  return command.kind === 'moveUnit' || command.kind === 'attackMoveUnit';
}

/**
 * Give a commander's walk order to its vehicle as a goto (`moveVehicle`, with its refusals): the crew
 * boards first through the goto's `waitsForHuman` hold. A commander outside and free to move drops its
 * own walk so the rider rung turns it to the door at once; one held by an atomic finishes it first, the
 * way a trader completes the unit it is loading before the cart leaves the stop. False when `e`
 * commands no vehicle, leaving the order to the ordinary walk.
 */
export function driveCommandedVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>,
): boolean {
  const e = command.entity;
  const vehicle = commandedVehicleOf(world, e);
  if (vehicle === null) return false;
  if (!moveVehicle(world, ctx, { kind: 'moveVehicle', vehicle, x: command.x, y: command.y })) return true;
  if (world.has(e, Position) && !atomicHoldsSettler(world, e)) {
    clearNavState(world, e);
    world.remove(e, PlayerOrder);
  }
  return true;
}
