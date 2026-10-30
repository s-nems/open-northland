import {
  EquipOrder,
  NeedOrder,
  PlayerOrder,
  TrainingOrder,
  Vehicle,
  VehicleDrive,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeManhattan } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { spokenFor } from '../../../ai-shared/military/errand.js';
import { towardNode } from '../../../ai-shared/node-geometry.js';
import { vehicleAnchor } from '../../../footprint/index.js';
import { anotherSystemOwns } from '../../../settlers/action-owner.js';
import { atomicHoldsSettler } from '../../../settlers/atomics/busy.js';
import { ASSAULT_RING_RADIUS_NODES, marchOrders } from '../muster.js';
import { VEHICLE_HOP_NODES } from '../siege-crew.js';
import { nodeOf } from './geometry.js';

// How a marching wave's men and catapults are ordered: the men onto a ring as one group attack-move, the
// catapults on attack-move drives.

/** Whether the wave may order `e` now: free, walking out one of its own attack-moves, which a new order
 *  replaces, or on a walk no order, errand, need or fight owns, as a guard's stale way back to his anchor,
 *  which would otherwise keep him out of the wave's walk. */
export function orderable(world: World, e: Entity): boolean {
  if (!spokenFor(world, e)) return true;
  const order = world.tryGet(e, PlayerOrder);
  if (order !== undefined) return order.attackMove !== undefined;
  return (
    !anotherSystemOwns(world, e) &&
    !world.has(e, TrainingOrder) &&
    !world.has(e, EquipOrder) &&
    !world.has(e, NeedOrder) &&
    !atomicHoldsSettler(world, e)
  );
}

/** An attack-move to `place` unless the catapult fights, or stands or drives within `slack` (hex) of it; a
 *  place past its reach is reached in hops. The stance goes to attack first. */
export function driveCatapult(
  world: World,
  vehicle: Entity,
  place: HalfCellNode,
  slack: number,
): PlayerCommand[] {
  const state = world.get(vehicle, Vehicle);
  const at = vehicleAnchor(world, vehicle);
  if (state.attack !== null || at === null) return [];
  const goal = world.tryGet(vehicle, VehicleDrive)?.goal ?? state.heldGoal ?? state.march?.goal ?? null;
  if (goal !== null && hexDistance(goal, place) <= slack) return [];
  if (goal === null && hexDistance(at, place) <= slack) return [];
  const hop = hexDistance(at, place) > VEHICLE_HOP_NODES ? towardNode(at, place, VEHICLE_HOP_NODES) : place;
  const commands: PlayerCommand[] = [];
  if (state.stance !== 'attack') commands.push({ kind: 'setVehicleStance', vehicle, stance: 'attack' });
  commands.push({ kind: 'moveVehicle', vehicle, x: hop.hx, y: hop.hy, attackMove: true });
  return commands;
}

/** {@link marchOrders} for the men not already headed into the ring around `centre`. */
export function ringOrders(
  world: World,
  terrain: TerrainGraph,
  men: readonly Entity[],
  centre: NodeId,
): PlayerCommand[] {
  const heading = men.filter((e) => {
    if (!orderable(world, e)) return false;
    const march = world.tryGet(e, PlayerOrder)?.attackMove;
    return (
      march === undefined ||
      nodeManhattan(nodeOf(terrain, march.goal), nodeOf(terrain, centre)) > ASSAULT_RING_RADIUS_NODES
    );
  });
  return marchOrders(world, terrain, heading, centre);
}

/** `commands` with their single attack-moves folded into one `attackMoveUnitGroup`, the order a player's
 *  selection click gives, after the rest. */
export function asGroupOrder(commands: readonly PlayerCommand[]): PlayerCommand[] {
  const rest: PlayerCommand[] = [];
  const members: { entity: Entity; x: number; y: number }[] = [];
  for (const c of commands) {
    if (c.kind === 'attackMoveUnit') members.push({ entity: c.entity, x: c.x, y: c.y });
    else rest.push(c);
  }
  if (members.length > 0) rest.push({ kind: 'attackMoveUnitGroup', members });
  return rest;
}
