import {
  carriedVehicles,
  PathRequest,
  Position,
  Rider,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
  vehiclePassengers,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { vehicleAnchor, vehicleDoorNode } from '../footprint/index.js';
import { clearNavState, redirectRoute } from '../movement/nav-state.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { anyNeedPressing } from '../settlers/drives/needs.js';
import { markLostWay } from '../settlers/lost-way.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
import {
  boardingNode,
  boardRider,
  isShipAtSea,
  landingOf,
  passengerJobAllowed,
  placeOnNode,
  refuseCrew,
  releaseRider,
  setDownRider,
} from './crew.js';
import { startDock } from './dock.js';
import { refuseMove, startVehicleDrive } from './movement.js';

// The boarding drives of docs/formats/VEHICLES.md "Crew" and "Ships and docking": a vehicle that needs its
// crew inside asks every rider on the door's continent to step in and drops the stragglers, and a cart
// or catapult loaded into a ship boards its own crew, drives to the ship's door and rides inside.

/** The continent a node belongs to, or -1 off the map. */
function continentAt(terrain: TerrainGraph, point: HalfCellNode): number {
  if (!terrain.inBounds(point.hx, point.hy)) return -1;
  return terrain.componentOf(terrain.nodeAt(point.hx, point.hy));
}

/** Whether `rider`, outside its vehicle, has a need the ladder will pull it away for: the original's
 *  `NeedTypeToFulfill` gate on the board request. */
function needPending(world: World, ctx: SystemContext, rider: Entity): boolean {
  return anyNeedPressing(world, ctx.content, rider);
}

/**
 * One pass of `l_Passengers_MoveIn`: every rider still outside is asked in when it stands on the door's
 * continent and has no pending need, and detached where it stands when on another continent. Returns
 * whether the whole crew is inside; a carried vehicle counts once it rides inside too.
 */
export function boardCrew(world: World, ctx: SystemContext, vehicle: Entity): boolean {
  const terrain = ctx.terrain;
  const state = world.get(vehicle, Vehicle);
  const door = vehicleDoorNode(world, ctx, vehicle);
  if (door === null || terrain === undefined) return vehiclePassengers(state).every((seat) => seat.inside);
  const continent = continentAt(terrain, door);
  let allInside = true;
  for (const seat of vehiclePassengers(state)) {
    if (seat.inside) continue;
    const rider = seat.entity;
    if (!world.isAlive(rider) || !world.has(rider, Position)) continue;
    const p = world.get(rider, Position);
    if (continentAt(terrain, nodeOfPosition(p.x, p.y)) !== continent) {
      releaseRider(world, rider, vehicle);
      continue;
    }
    allInside = false;
    if (needPending(world, ctx, rider)) continue;
    const live = world.tryMut(rider, Rider);
    if (live !== undefined && !live.boarding) live.boarding = true;
  }
  for (const seat of carriedVehicles(state)) {
    if (!seat.inside && world.isAlive(seat.entity)) allInside = false;
  }
  return allInside;
}

/**
 * The rider rung of the drive ladder, for an idle attached settler: walk to the vehicle's boarding node,
 * step in there when the vehicle asked, else stand by it. True when the rung took the settler.
 */
export function planRider(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): boolean {
  const rider = world.tryGet(e, Rider);
  if (rider === undefined) return false;
  const vehicle = rider.vehicle;
  if (!world.has(vehicle, Vehicle)) return false;
  const doorNode = boardingNode(world, ctx, terrain, vehicle);
  if (doorNode === null) return true; // the vehicle rides a carrier: nowhere to walk to
  const here = entityNode(world, terrain, e);
  if (here === doorNode) {
    if (rider.boarding && !isShipAtSea(ctx, world.get(vehicle, Vehicle))) boardRider(world, e, vehicle);
    return true;
  }
  redirectRoute(world, e, doorNode);
  return true;
}

/**
 * Keep riders consistent with their seats: a rider whose vehicle is gone or whose seat was taken away is
 * released, and one that cannot find a way to the door is dropped where it stands with a lost note. A
 * carrier's failed walk to a cargo source or store is not a lost door: it takes the planner's ordinary
 * stranded recovery and keeps its seat. Before the planner, so the ladder's rider rung only sees riders
 * that still belong somewhere.
 */
export const riderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  for (const e of canonicalById(world.query(Rider))) {
    const rider = world.get(e, Rider);
    const state = world.tryGet(rider.vehicle, Vehicle);
    const seated = state?.passengers.some((seat) => seat !== null && seat.entity === e) === true;
    if (!seated) {
      if (!world.has(e, Position)) {
        const landing = landingOf(world, ctx, rider.vehicle) ?? vehicleAnchor(world, rider.vehicle);
        if (landing !== null) setDownRider(world, e, landing);
      }
      world.remove(e, Rider);
      continue;
    }
    const request = world.tryGet(e, PathRequest);
    if (request?.failed !== true || !world.has(e, Position) || terrain === undefined) continue;
    if (request.goal !== boardingNode(world, ctx, terrain, rider.vehicle)) continue;
    markLostWay(world, ctx, e);
    clearNavState(world, e);
    releaseRider(world, e, rider.vehicle);
  }
};

/**
 * Whether a carried vehicle may ride inside `carrier` (`Passengers_CanVehicleMoveIn`): the carrier is a
 * moored ship holding a slot for it, the vehicle's crew fits the carrier's free passenger room, and the
 * vehicle stands on the continent of the carrier's door.
 */
function canRideInside(
  world: World,
  ctx: SystemContext,
  carrier: Entity,
  vehicle: Entity,
): 'ok' | 'noRoom' | 'cannotNearShip' {
  const terrain = ctx.terrain;
  const carrierState = world.get(carrier, Vehicle);
  const type = contentIndex(ctx.content).vehicles.get(carrierState.vehicleType);
  if (type === undefined || !isShipVehicle(type) || !carrierState.moored) return 'noRoom';
  const crew = vehiclePassengers(world.get(vehicle, Vehicle)).length;
  const room = carrierState.passengers.filter((seat) => seat === null).length;
  if (crew > room) return 'noRoom';
  const door = vehicleDoorNode(world, ctx, carrier);
  const anchor = vehicleAnchor(world, vehicle);
  if (door === null || anchor === null || terrain === undefined) return 'cannotNearShip';
  if (continentAt(terrain, door) !== continentAt(terrain, anchor)) return 'cannotNearShip';
  return 'ok';
}

/** Clear the slot `vehicle` holds on `carrier` and the vehicle's link back. */
export function releaseCarried(world: World, carrier: Entity, vehicle: Entity): void {
  const carrierState = world.tryGet(carrier, Vehicle);
  if (carrierState !== undefined) {
    const slot = carrierState.vehicles.findIndex((seat) => seat !== null && seat.entity === vehicle);
    if (slot >= 0) world.mut(carrier, Vehicle).vehicles[slot] = null;
  }
  const live = world.tryMut(vehicle, Vehicle);
  if (live !== undefined) {
    live.carrier = null;
    if (live.task === 'boardsShip') live.task = 'none';
  }
}

/** The load order - see the command doc. `CanVehicleBeAttached`: same owner, the vehicle's job in the
 *  carrier's list, a free vehicle slot; the drive then starts on the next boarding pass. */
export function loadIntoVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'loadIntoVehicle' }>,
): boolean {
  const { vehicle, carrier } = command;
  const state = world.tryGet(vehicle, Vehicle);
  const carrierState = world.tryGet(carrier, Vehicle);
  if (state === undefined || carrierState === undefined || vehicle === carrier) return false;
  if (state.carrier === carrier) return true;
  if (state.carrier !== null && !leaveCarrier(world, ctx, { kind: 'leaveCarrier', vehicle })) return false;
  const types = contentIndex(ctx.content).vehicles;
  const type = types.get(state.vehicleType);
  const carrierType = types.get(carrierState.vehicleType);
  const slot = carrierState.vehicles.indexOf(null);
  if (
    type === undefined ||
    carrierType === undefined ||
    !passengerJobAllowed(carrierType, type.jobId) ||
    slot < 0 ||
    vehicleAnchor(world, vehicle) === null
  ) {
    refuseCrew(world, ctx, vehicle, 'cannotAttach');
    return false;
  }
  world.mut(carrier, Vehicle).vehicles[slot] = { entity: vehicle, inside: false };
  const live = world.mut(vehicle, Vehicle);
  live.carrier = carrier;
  live.task = 'boardsShip';
  live.heldGoal = null;
  return true;
}

/** The leave order - see the command doc. */
export function leaveCarrier(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'leaveCarrier' }>,
): boolean {
  const vehicle = command.vehicle;
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined || state.carrier === null) return true;
  const carrier = state.carrier;
  if (vehicleAnchor(world, vehicle) === null) {
    const landing = landingOf(world, ctx, carrier);
    if (landing === null) {
      refuseCrew(world, ctx, vehicle, 'cannotLeave');
      return false;
    }
    placeOnNode(world, vehicle, landing); // the crew stays seated inside it
  }
  releaseCarried(world, carrier, vehicle);
  return true;
}

/** The vehicle's own boarding step for a goto: a held goal starts its drive once the crew is inside. */
function resumeHeldGoal(world: World, ctx: SystemContext, terrain: TerrainGraph, vehicle: Entity): void {
  const live = world.mut(vehicle, Vehicle);
  const goal = live.heldGoal;
  live.heldGoal = null;
  live.task = 'none';
  if (goal === null) return;
  const node = terrain.nodeAtClamped(goal.hx, goal.hy);
  if (!startVehicleDrive(world, ctx, terrain, vehicle, node)) {
    refuseMove(world, ctx, vehicle, 'noPath'); // still moored where it lay, its door on the old mooring
    return;
  }
  world.mut(vehicle, Vehicle).mooring = null;
}

/** A dock point held for boarding: the ship casts off toward it once the crew is inside, unless its
 *  commander left meanwhile, in which case the order lapses with the no-commander note. */
function resumeHeldDock(world: World, ctx: SystemContext, terrain: TerrainGraph, vehicle: Entity): void {
  const state = world.get(vehicle, Vehicle);
  const point = state.heldGoal;
  if (point === null) return;
  if (vehicleCommander(state) === null) {
    const live = world.mut(vehicle, Vehicle);
    live.heldGoal = null;
    live.task = 'none';
    refuseMove(world, ctx, vehicle, 'noCommander');
    return;
  }
  startDock(world, ctx, terrain, vehicle, { hx: point.hx, hy: point.hy });
}

/**
 * Drive the vehicles that wait on their crew or board a ship. `waitsForHuman` ends, and any held goto
 * starts, once every rider is inside; a dock point held under `docks` starts its sail the same way.
 * `boardsShip` boards the vehicle's own crew first, then drives to the carrier's door node and rides
 * inside on arrival; a carrier that cannot take it any more, or a door it cannot reach, drops the load
 * with the player's note.
 */
export const vehicleBoardingSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  for (const e of canonicalById(world.query(Vehicle, Position))) {
    const state = world.get(e, Vehicle);
    if (state.task === 'waitsForHuman') {
      if (boardCrew(world, ctx, e)) resumeHeldGoal(world, ctx, terrain, e);
      continue;
    }
    if (state.task === 'docks' && state.heldGoal !== null) {
      if (boardCrew(world, ctx, e)) resumeHeldDock(world, ctx, terrain, e);
      continue;
    }
    if (state.task !== 'boardsShip') continue;
    const carrier = state.carrier;
    if (carrier === null || !world.has(carrier, Vehicle)) {
      world.mut(e, Vehicle).task = 'none';
      continue;
    }
    const verdict = canRideInside(world, ctx, carrier, e);
    if (verdict !== 'ok') {
      refuseCrew(world, ctx, e, verdict);
      releaseCarried(world, carrier, e);
      continue;
    }
    if (!boardCrew(world, ctx, e)) continue;
    const door = vehicleDoorNode(world, ctx, carrier);
    const anchor = vehicleAnchor(world, e);
    if (door === null || anchor === null) continue;
    if (door.hx === anchor.hx && door.hy === anchor.hy) {
      rideInside(world, carrier, e);
      continue;
    }
    if (world.has(e, VehicleDrive)) continue; // still on its way to the door
    const doorNode = terrain.nodeAtClamped(door.hx, door.hy);
    if (!startVehicleDrive(world, ctx, terrain, e, doorNode)) {
      refuseCrew(world, ctx, e, 'cannotNearShip');
      releaseCarried(world, carrier, e);
    }
  }
};

/** Move the arrived vehicle into its carrier: it leaves the map, its crew still seated inside it. */
function rideInside(world: World, carrier: Entity, vehicle: Entity): void {
  const carrierState = world.get(carrier, Vehicle);
  const slot = carrierState.vehicles.findIndex((seat) => seat !== null && seat.entity === vehicle);
  if (slot < 0) return;
  const seat = world.mut(carrier, Vehicle).vehicles[slot];
  if (seat !== null && seat !== undefined) seat.inside = true;
  world.remove(vehicle, VehicleDrive);
  world.remove(vehicle, Position);
  world.mut(vehicle, Vehicle).task = 'none';
}
