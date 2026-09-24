import {
  isValidPlayer,
  ownerOf,
  Position,
  Rider,
  restampMissionId,
  Settler,
  stampOwner,
  Vehicle,
  VehicleDrive,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexagonRing, positionOfNode } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { vehicleAnchor, vehicleDoorNode } from '../../footprint/index.js';
import { removeSettlerSilently } from '../../lifecycle/death.js';
import { clearNavState } from '../../movement/nav-state.js';
import { vehicleTraversal } from '../../readviews/vehicles.js';
import { spawnSettler } from '../../spawn/index.js';
import { createVehicle } from '../../vehicles/create.js';
import { attachToVehicle, boardRider, detachFromVehicle, passengerJobAllowed } from '../../vehicles/crew.js';
import { vehicleWalkBlocks } from '../../vehicles/movement.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { removeVehicle } from '../../vehicles/remove.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHumans, missionVehicles, withinRange } from '../targets.js';

// The vehicle results of docs/formats/VEHICLES.md "Map scripts": every one goes through the seams a
// seat command or a map load takes, so a scripted vehicle and a placed one are the same entity.

/** How many vehicles one `RemoveVehiclesWithMissionId` takes, whatever carries the id (reading: the
 *  original fills a 50-entry buffer and stops). */
const SCRIPT_REMOVAL_CAP = 50;

/** How many vehicles one `MoveUnitsInArea` teleports beside its humans (reading: a 20-entry buffer). */
const VEHICLE_TELEPORT_CAP = 20;

/** How far around the destination a teleported vehicle may land, in hexagon rings, when the point
 *  itself cannot take it (approximation: the original stacks every vehicle on the point). */
const TELEPORT_LANDING_RADIUS = 9;

/**
 * `SetVehicle`: a vehicle of the type at the point for the player and tribe, with the id. With the
 * captain flag the line also spawns the type's `logiccommander` trade at the door, attaches and boards
 * it, and takes the human back when either step is refused; the commander carries the vehicle's id and
 * no behaviour. A type authoring no commander spawns bare.
 */
export function spawnScriptedVehicle(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SetVehicle' }>,
): void {
  const { world, ctx } = pass;
  const terrain = ctx.terrain;
  const type = contentIndex(ctx.content).vehicles.get(op.vehicleType);
  if (type === undefined || terrain === undefined || !terrain.inBounds(op.point.hx, op.point.hy)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  const vehicle = createVehicle(world, ctx, {
    vehicleType: op.vehicleType,
    x: op.point.hx,
    y: op.point.hy,
    tribe: op.tribe,
    owner: op.player,
    missionId: op.vehicleId,
  });
  if (vehicle === null || !op.withCaptain) return;
  const door = vehicleDoorNode(world, ctx, vehicle);
  const jobType = type.commanderJob;
  if (door === null || jobType === undefined || !terrain.inBounds(door.hx, door.hy)) return;
  const captain = world.nextEntityId as Entity; // the id the spawn's `create` takes
  spawnSettler(world, ctx, {
    kind: 'spawnSettler',
    jobType,
    tribe: op.tribe,
    x: door.hx,
    y: door.hy,
    owner: op.player,
    missionId: op.vehicleId,
  });
  if (!world.isAlive(captain) || !world.has(captain, Settler)) return; // the trade is not in the content
  if (!attachToVehicle(world, ctx, { kind: 'attachToVehicle', entity: captain, vehicle })) {
    removeSettlerSilently(world, captain);
    return;
  }
  boardRider(world, captain, vehicle);
}

/** `RemoveVehicles`: every vehicle with the id leaves the map the script way, with no wreck and no spill;
 *  a crew steps onto the door where it lies on land. */
export function removeScriptedVehicles(pass: MissionPass, id: number): void {
  for (const e of missionVehicles(pass.world, id)) removeVehicle(pass.world, pass.ctx, e, 'script');
}

/**
 * `RemoveVehiclesWithMissionId`: up to {@link SCRIPT_REMOVAL_CAP} vehicles with the id are removed the
 * same way, and with the flag every seated rider is taken off the board first, aboard or on its way.
 * Open: the original also stages a presentation callback on the two hexagon rings around each vehicle,
 * the same one its teleports stage, which is not identified and not mirrored.
 */
export function removeScriptedVehiclesWithCrews(pass: MissionPass, id: number, crews: boolean): void {
  const { world, ctx } = pass;
  for (const e of missionVehicles(world, id).slice(0, SCRIPT_REMOVAL_CAP)) {
    if (crews) {
      for (const seat of world.get(e, Vehicle).passengers) {
        if (seat !== null && world.isAlive(seat.entity)) removeSettlerSilently(world, seat.entity);
      }
    }
    removeVehicle(world, ctx, e, 'script');
  }
}

/** `ChangeVehiclesPlayerId`: the vehicles with the id change flag; their crews keep their own owner and
 *  their seats (the original touches nobody aboard). */
export function handVehiclesToPlayer(pass: MissionPass, id: number, player: number): void {
  if (!isValidPlayer(player)) return;
  for (const e of missionVehicles(pass.world, id)) stampOwner(pass.world, e, player);
}

/**
 * `AttachHumanToVehicle`: the first vehicle with the vehicle id takes every human with the human id
 * that the attach gate admits (same owner, an allowed trade, a free
 * slot), each through the seat's attach order; the rest are passed over without a note.
 */
export function attachScriptedHumans(pass: MissionPass, humanId: number, vehicleId: number): void {
  const { world, ctx } = pass;
  const vehicle = missionVehicles(world, vehicleId)[0];
  if (vehicle === undefined) return;
  const state = world.get(vehicle, Vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return;
  const owner = ownerOf(world, vehicle);
  for (const e of missionHumans(world, humanId)) {
    if (ownerOf(world, e) !== owner) continue;
    if (!passengerJobAllowed(type, world.tryGet(e, Settler)?.jobType ?? null)) continue;
    if (!world.get(vehicle, Vehicle).passengers.includes(null)) break; // full: nobody else fits
    attachToVehicle(world, ctx, { kind: 'attachToVehicle', entity: e, vehicle });
  }
}

/** `DetachHumanFromVehicle`: every rider with the id takes the seat's detach order. */
export function detachScriptedHumans(pass: MissionPass, humanId: number): void {
  const { world, ctx } = pass;
  for (const e of missionHumans(world, humanId)) {
    if (world.has(e, Rider)) detachFromVehicle(world, ctx, { kind: 'detachFromVehicle', entity: e });
  }
}

/** `ChangeMissionIdOfVehicles`: every vehicle carrying `from` carries `to` instead. */
export function renumberScriptedVehicles(pass: MissionPass, from: number, to: number): void {
  for (const e of missionVehicles(pass.world, from)) restampMissionId(pass.world, e, to);
}

/** `ChangeMissionIdOfVehiclesInRange`: the player's vehicles standing within `range` of the point. */
export function stampVehiclesInRange(
  pass: MissionPass,
  player: number,
  id: number,
  point: HalfCellNode,
  range: number,
): void {
  stampVehicles(pass, player, id, (e) => withinRange(pass.world, e, point, range));
}

/**
 * `ChangeMissionIdOfPlayersVehiclesOnContinent`: the player's vehicles whose standing node shares the
 * point's continent key; a moored ship is judged by its mooring point, the shore its door is on, the way
 * the original reads a moored ship's entry point. A vehicle riding a carrier stands nowhere.
 */
export function stampVehiclesOnContinent(
  pass: MissionPass,
  player: number,
  point: HalfCellNode,
  id: number,
): void {
  const terrain = pass.ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(point.hx, point.hy)) return;
  const continent = terrain.componentOf(terrain.nodeAt(point.hx, point.hy));
  if (continent < 0) return;
  stampVehicles(pass, player, id, (e) => {
    const at = standingNode(pass.world, e);
    if (at === null || !terrain.inBounds(at.hx, at.hy)) return false;
    return terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) === continent;
  });
}

function standingNode(world: World, e: Entity): HalfCellNode | null {
  const state = world.get(e, Vehicle);
  if (state.moored && state.mooring !== null) return state.mooring;
  return vehicleAnchor(world, e);
}

function stampVehicles(pass: MissionPass, player: number, id: number, keep: (e: Entity) => boolean): void {
  const { world } = pass;
  if (!isValidPlayer(player)) return;
  for (const e of [...vehicleIndex(world).ownedBy(player)]) {
    if (keep(e)) restampMissionId(world, e, id);
  }
}

/**
 * The vehicle half of `MoveUnitsInArea`: up to {@link VEHICLE_TELEPORT_CAP} of the player's vehicles
 * standing within `range` of the source, a carried one excepted, are set down at the destination and
 * their drives dropped. Each lands on the first node in hexagon-ring order of its own traversal that
 * its walk-block admits, so a group fans out where the original stacks it and then orders every
 * vehicle to the same point; a vehicle no node within {@link TELEPORT_LANDING_RADIUS} takes stays
 * where it was.
 */
export function teleportVehiclesInArea(
  pass: MissionPass,
  player: number,
  source: HalfCellNode,
  range: number,
  destination: HalfCellNode,
): void {
  const { world, ctx } = pass;
  const terrain = ctx.terrain;
  if (terrain === undefined || !isValidPlayer(player)) return;
  const claimed = new Set<NodeId>();
  let moved = 0;
  for (const e of [...vehicleIndex(world).ownedBy(player)]) {
    if (moved >= VEHICLE_TELEPORT_CAP) break;
    // One riding a carrier, or on its way into one, stays with the ship (the original's carrier test).
    if (world.get(e, Vehicle).carrier !== null || vehicleAnchor(world, e) === null) continue;
    if (!withinRange(world, e, source, range)) continue;
    if (teleportVehicle(world, ctx, terrain, e, destination, claimed)) moved++;
  }
}

function teleportVehicle(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  destination: HalfCellNode,
  claimed: Set<NodeId>,
): boolean {
  const state = world.get(e, Vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return false;
  const blocked = vehicleWalkBlocks(world, ctx, terrain, e, type);
  const traversal = vehicleTraversal(type);
  let landing: NodeId | null = null;
  for (let r = 0; r <= TELEPORT_LANDING_RADIUS && landing === null; r++) {
    for (const { point } of hexagonRing(destination, r)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const node = terrain.nodeAt(point.hx, point.hy);
      // The walk-block knows nothing of land and water: a cart must land on ground, a ship at sea.
      if (!terrain.traversable(node, traversal) || blocked.has(node) || claimed.has(node)) continue;
      landing = node;
      break;
    }
  }
  if (landing === null) return false;
  claimed.add(landing);
  const { x, y } = terrain.coordsOf(landing);
  const at = positionOfNode(x, y);
  const pos = world.mut(e, Position);
  pos.x = at.x;
  pos.y = at.y;
  world.remove(e, VehicleDrive);
  const live = world.mut(e, Vehicle);
  live.heldGoal = null;
  live.march = null; // a march would drive the vehicle straight back from where the script set it
  live.moored = false;
  live.mooring = null;
  live.guard = { hx: x, hy: y };
  if (live.task !== 'attacks') live.task = 'none';
  // Riders still walking to the old door re-aim at the new one on their next rung; a route they hold
  // points at where the vehicle no longer stands.
  for (const seat of live.passengers) {
    if (seat !== null && !seat.inside && world.isAlive(seat.entity)) clearNavState(world, seat.entity);
  }
  return true;
}
