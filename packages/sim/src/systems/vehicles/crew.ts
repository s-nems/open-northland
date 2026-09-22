import type { VehicleType } from '@open-northland/data';
import {
  AttackOrder,
  Engagement,
  HuntFocus,
  hasFreeSeat,
  ownerOf,
  Position,
  Rider,
  Settler,
  seatPassenger,
  setSeatInside,
  unseatPassenger,
  Vehicle,
  vehiclePassengers,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, MapContext, SystemContext } from '../context.js';
import { releaseEmployment } from '../economy/jobs/binding.js';
import { dynamicBlockOverlay, vehicleAnchor, vehicleDoorNode } from '../footprint/index.js';
import { clearNavState } from '../movement/nav-state.js';
import { isOrderableSettler } from '../orders/guards.js';
import { sendUnit } from '../orders/movement.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { releaseTowerPost } from '../settlers/drives/tower-post.js';
import { stepOut } from '../settlers/indoors.js';
import { endChat } from '../social/gossip/drive.js';
import { abandonCargoRun } from './cargo.js';

// The crew of docs/formats/VEHICLES.md "Crew": who may attach, where a rider boards and leaves, and what
// a rider gives up when it joins. The boarding drives live in `boarding.ts`.

/** Whether the type's `logicpassenger` list admits `jobType`; a jobless settler never rides. */
export function passengerJobAllowed(type: VehicleType, jobType: number | null): boolean {
  return jobType !== null && type.passengerJobs.includes(jobType);
}

/**
 * Whether the attach order would seat `settler` on `vehicle`: the settler's own vehicle, an own vehicle
 * whose type admits the settler's job with a seat free, and a door the settler can walk to: on the
 * settler's own continent, a moored ship's shore or a land vehicle's node (a ship at sea has none). The
 * ring's "Assign Vehicle" pick lights vehicles by it. {@link attachToVehicle} applies the same gates but
 * the walk, which the boarding judges after the attach as the original does, detaching a rider that
 * cannot reach the door.
 */
export function canAttachToVehicle(world: World, ctx: MapContext, settler: Entity, vehicle: Entity): boolean {
  if (!isOrderableSettler(world, settler)) return false;
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined || ownerOf(world, vehicle) !== ownerOf(world, settler)) return false;
  if (world.tryGet(settler, Rider)?.vehicle === vehicle) return true;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || !passengerJobAllowed(type, world.get(settler, Settler).jobType)) return false;
  return hasFreeSeat(state) && doorReachable(world, ctx, settler, vehicle);
}

/**
 * Whether `settler` stands on the continent of `vehicle`'s door. A vehicle riding a carrier or a
 * settler aboard one is judged where it would step out. True without a map, where nothing walks.
 */
function doorReachable(world: World, ctx: MapContext, settler: Entity, vehicle: Entity): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return true;
  const door = landingOf(world, ctx, vehicle);
  if (door === null || !terrain.inBounds(door.hx, door.hy)) return false;
  const position = world.tryGet(settler, Position);
  const rider = world.tryGet(settler, Rider);
  const from =
    position !== undefined
      ? nodeOfPosition(position.x, position.y)
      : rider === undefined
        ? null
        : landingOf(world, ctx, rider.vehicle);
  if (from === null || !terrain.inBounds(from.hx, from.hy)) return false;
  return (
    terrain.componentOf(terrain.nodeAt(from.hx, from.hy)) ===
    terrain.componentOf(terrain.nodeAt(door.hx, door.hy))
  );
}

/** Whether `vehicle` is a ship lying at sea: its riders may neither step in nor out. */
export function isShipAtSea(ctx: ContentContext, vehicle: { vehicleType: number; moored: boolean }): boolean {
  const type = contentIndex(ctx.content).vehicles.get(vehicle.vehicleType);
  return type !== undefined && isShipVehicle(type) && !vehicle.moored;
}

export function refuseRider(
  world: World,
  ctx: SystemContext,
  rider: Entity,
  reason: 'cannotEnter' | 'cannotLeave',
): void {
  ctx.events.emit({ kind: 'riderRefused', entity: rider, player: ownerOf(world, rider) ?? null, reason });
}

export function refuseCrew(
  world: World,
  ctx: SystemContext,
  vehicle: Entity,
  reason: 'noRoom' | 'cannotAttach' | 'cannotNearShip' | 'cannotLeave' | 'noCarrier',
): void {
  ctx.events.emit({
    kind: 'vehicleCrewRefused',
    entity: vehicle,
    player: ownerOf(world, vehicle) ?? null,
    reason,
  });
}

/**
 * The attach order - see the command doc. The rider gives up its workplace, its post, its fight
 * (the original's attach detaches the work house and resets the attack targets) and its
 * chat, and walks to the door through the unconfined walk order, which also sets a carried load down first.
 */
export function attachToVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attachToVehicle' }>,
): boolean {
  const e = command.entity;
  const vehicle = command.vehicle;
  if (!isOrderableSettler(world, e)) return false;
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined || ownerOf(world, vehicle) !== ownerOf(world, e)) return false;
  const current = world.tryGet(e, Rider);
  if (current?.vehicle === vehicle) return true;
  if (current !== undefined && !detachFromVehicle(world, ctx, { kind: 'detachFromVehicle', entity: e })) {
    return false;
  }
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || !passengerJobAllowed(type, world.get(e, Settler).jobType)) {
    refuseRider(world, ctx, e, 'cannotEnter');
    return false;
  }
  if (!seatPassenger(world, vehicle, e)) {
    refuseCrew(world, ctx, vehicle, 'noRoom');
    return false;
  }
  releaseTowerPost(world, ctx, e);
  releaseEmployment(world, ctx, e);
  stepOut(world, e);
  world.remove(e, Engagement);
  world.remove(e, AttackOrder);
  world.remove(e, HuntFocus);
  endChat(world, ctx.tick, e);
  world.add(e, Rider, { vehicle, boarding: false });
  const door = vehicleDoorNode(world, ctx, vehicle);
  // The walk order snaps a door another blocker covers to the node beside it, as the rider rung does.
  if (door !== null && world.has(e, Position)) sendUnit(world, ctx, e, door.hx, door.hy);
  return true;
}

/**
 * The detach order - see the command doc. Returns whether the settler is now free of any vehicle. A
 * rider inside a ship at sea stays aboard with `cannotLeave` (approximation: the original refuses this
 * silently); a rider of a vehicle riding a carrier steps out onto the carrier's door.
 */
export function detachFromVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'detachFromVehicle' }>,
): boolean {
  const e = command.entity;
  const rider = world.tryGet(e, Rider);
  if (rider === undefined) return true;
  const vehicle = rider.vehicle;
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined) {
    world.remove(e, Rider);
    return true;
  }
  if (!world.has(e, Position)) {
    const landing = landingOf(world, ctx, vehicle);
    if (landing === null) {
      refuseRider(world, ctx, e, 'cannotLeave');
      return false;
    }
    setDownRider(world, e, landing);
  }
  releaseRider(world, e, vehicle);
  return true;
}

/** Drop `rider`'s seat, marker and any cargo booking; the vehicle promotes the next commander. */
export function releaseRider(world: World, rider: Entity, vehicle: Entity): void {
  if (world.has(vehicle, Vehicle)) unseatPassenger(world, vehicle, rider);
  abandonCargoRun(world, rider);
  world.remove(rider, Rider);
}

/**
 * The node a rider boards `vehicle` from and steps out onto: the door node, or, where another blocker
 * covers it, the nearest open node around it in the walk's ring order (approximation: the original walks
 * the human onto the entry point and only its door lookup moves it). Null for a vehicle riding a
 * carrier, which has no door on the map.
 */
export function boardingNode(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): NodeId | null {
  const door = vehicleDoorNode(world, ctx, vehicle);
  if (door === null) return null;
  const node = terrain.nodeAtClamped(door.hx, door.hy);
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  if (terrain.isWalkable(node) && !blocked.has(node)) return node;
  return ringSearch(terrain, node, STAND_SEARCH_CAP, { accept: (n) => !blocked.has(n) });
}

/**
 * Where a rider stepping out of `vehicle` lands: its boarding node, or the carrier's while the vehicle
 * rides inside a ship; the bare door without a terrain. Null for a ship at sea, whose riders stay aboard.
 */
export function landingOf(world: World, ctx: MapContext, vehicle: Entity): HalfCellNode | null {
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined) return null;
  if (state.carrier !== null && vehicleAnchor(world, vehicle) === null)
    return landingOf(world, ctx, state.carrier);
  if (isShipAtSea(ctx, state)) return null;
  const terrain = ctx.terrain;
  if (terrain === undefined) return vehicleDoorNode(world, ctx, vehicle);
  const node = boardingNode(world, ctx, terrain, vehicle);
  return node === null ? null : { hx: terrain.xOf(node), hy: terrain.yOf(node) };
}

/** Stand `e` on `point`, restoring the Position that boarding gave up. */
export function placeOnNode(world: World, e: Entity, point: HalfCellNode): void {
  const at = positionOfNode(point.hx, point.hy);
  const pos = world.tryMut(e, Position);
  if (pos === undefined) world.add(e, Position, at);
  else {
    pos.x = at.x;
    pos.y = at.y;
  }
}

/** Put a rider back on the map at `point`, its seat now outside. */
export function setDownRider(world: World, rider: Entity, point: HalfCellNode): void {
  placeOnNode(world, rider, point);
  const seat = world.tryGet(rider, Rider);
  if (seat !== undefined && world.has(seat.vehicle, Vehicle))
    setSeatInside(world, seat.vehicle, rider, false);
}

/**
 * Step an attached rider standing on the door inside: it leaves the map (the original detaches the
 * human from the map and resets its targets). Authored scenes seat a crew this way before tick zero.
 */
export function boardRider(world: World, rider: Entity, vehicle: Entity): void {
  if (!setSeatInside(world, vehicle, rider, true)) return;
  clearNavState(world, rider);
  world.remove(rider, Engagement);
  world.remove(rider, AttackOrder);
  world.remove(rider, HuntFocus);
  world.remove(rider, Position);
  const seat = world.tryMut(rider, Rider);
  if (seat === undefined) world.add(rider, Rider, { vehicle, boarding: false });
  else {
    seat.vehicle = vehicle;
    seat.boarding = false;
  }
}

/**
 * The board order - see the command doc: the rider steps in when it reaches the door, which the ladder's
 * rider rung does. A ship at sea has no door to step in at.
 */
export function boardVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'boardVehicle' }>,
): void {
  const e = command.entity;
  const rider = world.tryGet(e, Rider);
  if (rider === undefined || !world.has(e, Position)) return;
  const state = world.tryGet(rider.vehicle, Vehicle);
  if (state === undefined) return;
  if (isShipAtSea(ctx, state)) {
    refuseRider(world, ctx, e, 'cannotEnter');
    return;
  }
  if (!rider.boarding) world.mut(e, Rider).boarding = true;
}

/** The unload-people order - see the command doc. Every rider, aboard or on its way, is freed, and an
 *  order held for their boarding lapses with them. */
export function unloadPeople(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'unloadPeople' }>,
): void {
  const vehicle = command.vehicle;
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined) return;
  const landing = landingOf(world, ctx, vehicle);
  if (landing === null) return;
  for (const seat of vehiclePassengers(state)) {
    if (!world.isAlive(seat.entity)) continue;
    if (seat.inside) setDownRider(world, seat.entity, landing);
    releaseRider(world, seat.entity, vehicle);
  }
  const live = world.mut(vehicle, Vehicle);
  live.heldGoal = null;
  if (live.task === 'waitsForHuman' || live.task === 'docks') live.task = 'none';
}

/**
 * Detach `e` ahead of an ordinary order that takes it elsewhere - the original's forced detach before a
 * work, walk, attack or home command. False when the rider may not leave, in which case the order is
 * dropped (`riderRefused` already told the player).
 */
export function detachBeforeOrder(world: World, ctx: SystemContext, e: Entity): boolean {
  if (!world.has(e, Rider)) return true;
  return detachFromVehicle(world, ctx, { kind: 'detachFromVehicle', entity: e });
}

/** The player commands that take a settler away from its vehicle first. Approximation: the original's
 *  list is not confirmed exhaustively. The walk orders reach here only for a rider that is not the commander: the commander's
 *  go to its vehicle (`commander.ts`). */
export function forcesDetach(command: Command): command is Command & { entity: Entity } {
  switch (command.kind) {
    case 'moveUnit':
    case 'attackMoveUnit':
    case 'attackUnit':
    case 'assignWorker':
    case 'setJob':
    case 'assignBuilder':
    case 'assignHouse':
    case 'trainSoldier':
    case 'learn':
    case 'exploreArea':
    case 'placeSignpost':
    case 'openChest':
    case 'marry':
    case 'orderNeed':
    case 'equipGood':
      return true;
    default:
      return false;
  }
}
