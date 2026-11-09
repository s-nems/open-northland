import {
  carriedVehicles,
  dropVehicleOrderQueue,
  PathRequest,
  Position,
  Rider,
  Settler,
  StandIn,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
  vehiclePassengers,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { vehicleAnchor, vehicleDoorNode } from '../footprint/index.js';
import { clearNavState, redirectRoute } from '../movement/nav-state.js';
import { sendUnit } from '../orders/movement.js';
import { isFighterJob } from '../readviews/jobs.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { markLostWay } from '../settlers/lost-way.js';
import { type IdleStands, wakeIdle } from '../settlers/planner/idle-replan.js';
import type { PlannerSpacing } from '../settlers/planner/spacing.js';
import { entityNode } from '../spatial/nodes.js';
import { isCarrierJob } from '../stores/workplace.js';
import {
  boardingNode,
  boardRider,
  isShipAtSea,
  landingOf,
  landRider,
  passengerJobAllowed,
  pinnedTraderAshore,
  refuseCrew,
  releaseCarried,
  releaseRider,
  setDownCarried,
} from './crew.js';
import { startDock } from './dock.js';
import {
  dropHeldGoal,
  endDrive,
  endMarch,
  refuseMove,
  snapVehicleTarget,
  startHeldDrive,
  startVehicleDrive,
} from './movement.js';
import { type VehicleWorkFilter, vehiclesAtWork } from './registry.js';
import { cargoHandHasWork } from './stock.js';

// The boarding drives of docs/formats/VEHICLES.md "Crew" and "Ships and docking": a vehicle that needs its
// crew inside asks every rider on the door's continent to step in and drops the stragglers, and a cart
// or catapult loaded into a ship boards its own crew, drives to the ship's door and rides inside.

/** The continent a node belongs to, or -1 off the map. */
function continentAt(terrain: TerrainGraph, point: HalfCellNode): number {
  if (!terrain.inBounds(point.hx, point.hy)) return -1;
  return terrain.componentOf(terrain.nodeAt(point.hx, point.hy));
}

function standsOnGround(terrain: TerrainGraph, point: HalfCellNode): boolean {
  return terrain.inBounds(point.hx, point.hy) && terrain.isWalkable(terrain.nodeAt(point.hx, point.hy));
}

/**
 * One pass of the crew's boarding: every rider still outside is asked in when it stands on the door's
 * continent, and detached where it stands when on another continent. Returns whether the whole crew is
 * inside; a carried vehicle counts once it rides inside too, and a ship's pinned trader still on its way
 * keeps the crew outside. Deviation (owner's choice): the original skips a
 * rider with a pending need; here the vehicle's order is a forced boarding, and the rider rung answers
 * it over the need, which stands still aboard.
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
    const at = nodeOfPosition(p.x, p.y);
    // A walker mid-step can round onto the unwalkable node beside its leg, which on a one-node strip
    // of shore is the sea; it is judged once it stands on ground.
    if (standsOnGround(terrain, at) && continentAt(terrain, at) !== continent) {
      releaseRider(world, rider, vehicle);
      continue;
    }
    allInside = false;
    if (world.tryGet(rider, Rider)?.boarding === false) {
      world.mut(rider, Rider).boarding = true;
      wakeIdle(world, rider); // a rider waiting by the door answers the ask on this tick's pass
    }
  }
  for (const seat of carriedVehicles(state)) {
    if (!seat.inside && world.isAlive(seat.entity)) allInside = false;
  }
  return allInside && pinnedTraderAshore(world, ctx, vehicle) === null;
}

/**
 * Whether a rider steps in as soon as it reaches the door, unasked: everyone but the crew that works its
 * vehicle from outside, a carrier serving the hold or another cargo hand with cargo to move, who wait by
 * the door for their own rungs until the vehicle asks. Deviation (owner's choice): the
 * original keeps every rider outside until the vehicle's order asks it in.
 */
function boardsUnasked(world: World, ctx: SystemContext, vehicle: Entity, e: Entity): boolean {
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null || isCarrierJob(ctx, jobType)) return false;
  return !cargoHandHasWork(world, ctx.content, vehicle, e);
}

/**
 * Whether `e` stands at `doorNode` for boarding: on it, on a neighbour while another settler holds the
 * door, or on the stand-in the router gave it for the door, however far a standing crowd pushed that
 * (approximation: the original boards only from the door point, but its humans stand through each other,
 * while a collider here can never share the door with a bystander). Without the stand-in case a crew
 * idling round the door, such as one just landed, would hold every rider of the next crew off for good.
 */
function standsAtDoor(
  world: World,
  terrain: TerrainGraph,
  spacing: PlannerSpacing,
  e: Entity,
  here: NodeId,
  doorNode: NodeId,
): boolean {
  if (here === doorNode) return true;
  const stood = world.tryGet(e, StandIn);
  if (stood !== undefined && stood.goal === doorNode && stood.at === here) return true;
  const door = terrain.coordsOf(doorNode);
  const at = terrain.coordsOf(here);
  if (hexDistance({ hx: at.x, hy: at.y }, { hx: door.x, hy: door.y }) !== 1) return false;
  return spacing.occupancy.at(door.x, door.y).some((other) => other !== e);
}

/**
 * The rider rung of the drive ladder, for an idle attached settler: walk to the vehicle's boarding node
 * and step in there, at once for a passenger, once the vehicle asks for a carrier. True when
 * the rung took the settler. A rider left waiting by the door, or with no door to walk to, stands on the
 * idle cadence: the vehicle's ask, an order or a route command wakes it.
 */
export function planRider(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  spacing: PlannerSpacing,
  idle: IdleStands,
): boolean {
  const rider = world.tryGet(e, Rider);
  if (rider === undefined) return false;
  const vehicle = rider.vehicle;
  if (!world.has(vehicle, Vehicle)) return false;
  const doorNode = boardingNode(world, ctx, terrain, vehicle);
  if (doorNode === null) {
    idle.stand(e, false); // the vehicle rides a carrier: nowhere to walk to
    return true;
  }
  const here = entityNode(world, terrain, e);
  if (standsAtDoor(world, terrain, spacing, e, here, doorNode)) {
    const steps = rider.boarding || boardsUnasked(world, ctx, vehicle, e);
    if (steps && !isShipAtSea(ctx, world.get(vehicle, Vehicle))) boardRider(world, e, vehicle);
    else idle.stand(e, false);
    return true;
  }
  redirectRoute(world, e, doorNode);
  return true;
}

/**
 * Keep riders consistent with their seats: a rider whose vehicle is gone or whose seat was taken away is
 * released, one holding a script's detach steps out as soon as its ship lies moored, and one that cannot
 * find a way to the door is dropped where it stands with a lost note. A cargo hand's failed walk to a
 * cargo source or store is not a lost door: it takes the planner's ordinary stranded recovery and keeps
 * its seat. Before the planner, so the ladder's rider rung only sees riders that still belong somewhere.
 */
export const riderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  for (const e of world.canonicalQuery(Rider)) {
    const rider = world.get(e, Rider);
    const state = world.tryGet(rider.vehicle, Vehicle);
    const seated = state?.passengers.some((seat) => seat !== null && seat.entity === e) === true;
    if (!seated) {
      if (!world.has(e, Position)) {
        const landing = landingOf(world, ctx, rider.vehicle) ?? vehicleAnchor(world, rider.vehicle);
        if (landing !== null) landRider(world, ctx, e, landing);
      }
      releaseRider(world, e, rider.vehicle); // gives any cargo booking back too
      continue;
    }
    if (rider.leaving !== null && !world.has(e, Position)) {
      const landing = landingOf(world, ctx, rider.vehicle);
      if (landing === null) continue; // still at sea: the order waits for the mooring
      const walkOn = rider.leaving.to;
      landRider(world, ctx, e, landing);
      releaseRider(world, e, rider.vehicle);
      if (walkOn !== null) {
        const attackMove = isFighterJob(ctx.content, world.tryGet(e, Settler)?.jobType ?? null);
        sendUnit(world, ctx, e, walkOn.hx, walkOn.hy, { attackMove }); // the line's march, as scripted-march.ts issues it
      }
      continue;
    }
    const request = world.tryGet(e, PathRequest);
    if (request?.failed !== true || !world.has(e, Position) || terrain === undefined) continue;
    if (request.goal !== boardingNode(world, ctx, terrain, rider.vehicle)) continue;
    markLostWay(world, ctx, e, request.goal);
    clearNavState(world, e);
    releaseRider(world, e, rider.vehicle);
  }
};

/**
 * Whether a carried vehicle may ride inside `carrier`: the carrier is a
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
  dropVehicleOrderQueue(world, vehicle);
  if (state.carrier === carrier) return true;
  if (state.hauler !== null || carrierState.hauler !== null) {
    // A carrier's hauling cart goes nowhere without it, and a trader's pinned ship keeps its slot.
    refuseCrew(world, ctx, vehicle, 'cannotAttach');
    return false;
  }
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
  dropHeldGoal(world, vehicle);
  endMarch(world, vehicle);
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
  if (state.hauler !== null) {
    refuseCrew(world, ctx, vehicle, 'cannotLeave'); // a hauling cart comes off with its puller (`landRider`)
    return false;
  }
  const carrier = state.carrier;
  if (vehicleAnchor(world, vehicle) === null) {
    const landing = landingOf(world, ctx, carrier);
    if (landing === null) {
      refuseCrew(world, ctx, vehicle, 'cannotLeave');
      return false;
    }
    setDownCarried(world, ctx, vehicle, landing); // the crew stays seated inside it
  }
  releaseCarried(world, carrier, vehicle);
  return true;
}

/** The vehicle's own boarding step for a goto: a held goal starts its drive once the crew is inside,
 *  unless its commander left meanwhile, in which case the order lapses with the no-commander note. */
function resumeHeldGoal(world: World, ctx: SystemContext, terrain: TerrainGraph, vehicle: Entity): void {
  const live = world.mut(vehicle, Vehicle);
  const goal = live.heldGoal;
  live.heldGoal = null;
  live.heldDock = null;
  live.task = 'none';
  if (goal === null) return;
  if (vehicleCommander(live) === null) {
    dropHeldGoal(world, vehicle);
    refuseMove(world, ctx, vehicle, 'noCommander');
    return;
  }
  const node = terrain.nodeAtClamped(goal.hx, goal.hy);
  if (!startHeldDrive(world, ctx, terrain, vehicle, node)) {
    dropHeldGoal(world, vehicle);
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
    dropHeldGoal(world, vehicle);
    world.mut(vehicle, Vehicle).task = 'none';
    refuseMove(world, ctx, vehicle, 'noCommander');
    return;
  }
  const dock = state.heldDock;
  startDock(
    world,
    ctx,
    terrain,
    vehicle,
    { hx: point.hx, hy: point.hy },
    dock === null ? null : { hx: dock.hx, hy: dock.hy },
  );
}

/** The tasks the boarding pass drives. */
const boardingTask: VehicleWorkFilter = (_content, state) =>
  state.task === 'waitsForHuman' ||
  state.task === 'boardsShip' ||
  (state.task === 'docks' && state.heldGoal !== null);

/**
 * Drive the vehicles that wait on their crew or board a ship. `waitsForHuman` ends, and any held goto
 * starts, once every rider is inside; a dock point held under `docks` starts its sail the same way.
 * `boardsShip` boards the vehicle's own crew first, then drives to the carrier's door node and rides
 * inside on arrival; a carrier that cannot take it any more, or a door it cannot reach, drops the load
 * with the player's note. A vehicle whose disc does not fit on the door, such as a catapult on a ship's
 * waterline mooring, drives to the nearest node near it that it may stand on and rides inside from there
 * (approximation: the original's entry point is the door itself).
 */
export const vehicleBoardingSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  for (const e of vehiclesAtWork(world, ctx.content, boardingTask)) {
    if (!world.has(e, Position)) continue;
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
    const stand = snapVehicleTarget(world, ctx, terrain, e, door);
    if (stand === terrain.nodeAt(anchor.hx, anchor.hy)) {
      rideInside(world, carrier, e);
      continue;
    }
    if (stand === null || !startVehicleDrive(world, ctx, terrain, e, stand)) {
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
  endDrive(world, vehicle);
  world.remove(vehicle, Position);
  world.mut(vehicle, Vehicle).task = 'none';
}
