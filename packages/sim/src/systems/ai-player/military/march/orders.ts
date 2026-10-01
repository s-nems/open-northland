import {
  AttackOrder,
  Building,
  EquipOrder,
  NeedOrder,
  PlayerOrder,
  Stance,
  TrainingOrder,
  Vehicle,
  VehicleDrive,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, hexDistance, hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { vehicleAnchor } from '../../../footprint/index.js';
import { MILITARY_MODE } from '../../../readviews/index.js';
import { anotherSystemOwns } from '../../../settlers/action-owner.js';
import { atomicHoldsSettler } from '../../../settlers/atomics/busy.js';
import { entityNode } from '../../../spatial/nodes.js';
import { towardNode } from '../../node-geometry.js';
import { isRangedFighter } from '../census.js';
import { spokenFor } from '../errand.js';
import { ASSAULT_RING_RADIUS_NODES, marchOrders } from '../muster.js';
import { VEHICLE_HOP_NODES } from '../siege-crew.js';
import { manhattanOf, nodeOf } from './geometry.js';

// How a marching wave's men and catapults are ordered: to their places, onto a ring, or at the fire
// they stand in.

/** How near his place a man counts as standing on it: he is neither re-ordered nor re-anchored. */
export const SLOT_SLACK_NODES = 2;

/** The wave as one decision reads it. */
export interface Wave {
  /** The men this decision may order, ascending id. */
  readonly men: readonly Entity[];
  /** Every man still with the wave, those in a fight included: the formation places them all. */
  readonly members: readonly Entity[];
  /** The catapults with a driver, ascending id. */
  readonly catapults: readonly Entity[];
  readonly centre: HalfCellNode;
}

/** Whether the wave may order `e` now: free, walking out one of its own attack-moves, which a new order
 *  replaces, or on a walk no order, errand, need or fight owns, as a guard's stale way back to his anchor,
 *  which would otherwise hold its leg until the timeout. */
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

/** A shooter the wave's melee may be caught by: a manned tower post, whose tower is what a man can
 *  strike, or a loose enemy archer. */
export interface Fire {
  readonly target: Entity;
  readonly x: number;
  readonly y: number;
  readonly reach: number;
}

/**
 * Walk each man to his place with an attack-move, so he fights what he meets on the way, unless he stands
 * on it or is headed there already. Behind catapults (`fire` not null) a man standing on his place takes
 * the `hold` stance anchored there (`conflict/engagement.ts`): DEFEND answers what comes near without
 * chasing it out past the catapult line, IGNORE only what reaches him. The march itself goes out on ATTACK,
 * since a stale anchor would walk him back. Neither stance answers a tower garrison, whom no fighter may
 * target, nor IGNORE an archer's shot, so a melee man standing in `fire` goes at the shooter's tower or
 * at the archer himself rather than stand and take the arrows.
 */
export function placeOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  men: readonly Entity[],
  places: ReadonlyMap<Entity, HalfCellNode>,
  fire: readonly Fire[] | null,
  hold: typeof MILITARY_MODE.DEFEND | typeof MILITARY_MODE.IGNORE,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const e of men) {
    const place = places.get(e);
    if (place === undefined || !orderable(world, e)) continue;
    const march = world.tryGet(e, PlayerOrder)?.attackMove;
    if (march !== undefined && manhattanOf(nodeOf(terrain, march.goal), place) <= SLOT_SLACK_NODES) continue;
    const here = entityNode(world, terrain, e);
    const stance = world.tryGet(e, Stance);
    if (march === undefined && manhattanOf(nodeOf(terrain, here), place) <= SLOT_SLACK_NODES) {
      if (fire === null) continue;
      const { x, y } = terrain.coordsOf(here);
      const shooter = isRangedFighter(world, ctx, e) ? null : nearestFireOn(fire, x, y);
      if (shooter !== null) {
        commands.push({ kind: 'attackUnit', entity: e, target: shooter });
        continue;
      }
      const anchor = stance?.anchorCell ?? null;
      const anchored =
        stance?.mode === hold &&
        anchor !== null &&
        manhattanOf(nodeOf(terrain, anchor), nodeOf(terrain, here)) <= SLOT_SLACK_NODES;
      if (!anchored) commands.push({ kind: 'setStance', entity: e, mode: hold });
      continue;
    }
    if (stance?.mode !== MILITARY_MODE.ATTACK) {
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    }
    commands.push({ kind: 'attackMoveUnit', entity: e, x: place.hx, y: place.hy });
  }
  return commands;
}

/**
 * Walk back to his place each man of `members` still on a building the wave's hold or siege set him at,
 * unless a shooter of that building's in `fire` reaches him, whom {@link placeOrders} sets him at again. His
 * focus outlasts the fight that gave it, and the leg would wait on him while the building stands.
 */
export function recallOrders(
  world: World,
  terrain: TerrainGraph,
  members: readonly Entity[],
  places: ReadonlyMap<Entity, HalfCellNode>,
  fire: readonly Fire[],
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const e of members) {
    const order = world.tryGet(e, AttackOrder);
    const place = places.get(e);
    if (order === undefined || order.breach !== undefined || place === undefined) continue;
    if (!world.has(order.target, Building)) continue;
    const { x, y } = terrain.coordsOf(entityNode(world, terrain, e));
    const shotAt = fire.some(
      (s) => s.target === order.target && hexDistanceBetween(s.x, s.y, x, y) <= s.reach,
    );
    if (shotAt) continue;
    if (world.tryGet(e, Stance)?.mode !== MILITARY_MODE.ATTACK) {
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    }
    commands.push({ kind: 'attackMoveUnit', entity: e, x: place.hx, y: place.hy });
  }
  return commands;
}

/**
 * Drive each catapult to its place on an attack-move, unless it fights, stands there or drives there
 * already. The places are snapped to ground the catapult may stand on, so it arrives on them.
 */
export function catapultOrders(
  world: World,
  catapults: readonly Entity[],
  places: ReadonlyMap<Entity, HalfCellNode>,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const vehicle of catapults) {
    const place = places.get(vehicle);
    if (place !== undefined) commands.push(...driveCatapult(world, vehicle, place, SLOT_SLACK_NODES));
  }
  return commands;
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

/** The target of the nearest shooter whose reach covers `(x, y)`, the lowest id on a tie, or null. */
function nearestFireOn(fire: readonly Fire[], x: number, y: number): Entity | null {
  let best: { target: Entity; distance: number } | null = null;
  for (const shooter of fire) {
    const distance = hexDistanceBetween(shooter.x, shooter.y, x, y);
    if (distance > shooter.reach) continue;
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && shooter.target < best.target)
    ) {
      best = { target: shooter.target, distance };
    }
  }
  return best?.target ?? null;
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
      manhattanOf(nodeOf(terrain, march.goal), nodeOf(terrain, centre)) > ASSAULT_RING_RADIUS_NODES
    );
  });
  return marchOrders(world, terrain, heading, centre);
}
