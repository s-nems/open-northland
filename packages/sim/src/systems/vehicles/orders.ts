import { Building, Health, Position, Settler, Vehicle, vehicleCommander } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { orderedAttack, vehicleWeapon } from '../conflict/engage-vehicle.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { crewInside, refuseMove } from './movement.js';

// The player's siege orders on a vehicle: its stance and what it fires at. The combat pass acts on
// both (`conflict/engage-vehicle.ts`).

/** The stance order: re-anchors the guard position on the node the vehicle stands on, and a held
 *  auto target is dropped so the new stance's scan picks afresh; an ordered one is kept. */
export function setVehicleStance(
  world: World,
  command: Extract<Command, { kind: 'setVehicleStance' }>,
): void {
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  if (state === undefined) return;
  const anchor = vehicleAnchor(world, e);
  const live = world.mut(e, Vehicle);
  live.stance = command.stance;
  if (anchor !== null) live.guard = anchor;
  if (live.attack !== null && !live.attack.ordered) {
    live.attack = null;
    if (live.task === 'attacks') live.task = 'none';
  }
}

/**
 * The attack order: an armed, commanded vehicle takes the target and the combat pass closes on it or
 * fires. A crew still outside is boarded first: the order waits under `waitsForHuman`, the twin of the
 * goto's held goal, and the combat pass takes it up once everyone is inside. Refused with
 * `vehicleMoveRefused` `noCommander` while nobody commands the vehicle; an unarmed vehicle, a target
 * that is not a unit, house or vehicle, or a map point off the map orders nothing.
 */
export function attackWithVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attackWithVehicle' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  if (state === undefined || state.carrier !== null || vehicleWeapon(ctx, state) === null) return;
  if (vehicleCommander(state) === null) {
    refuseMove(world, ctx, e, 'noCommander');
    return;
  }
  const target = command.target;
  // The payload check admits either shape's fields as optional, so a wire target is re-checked here.
  if (target.kind === 'ground') {
    if (!Number.isInteger(target.hx) || !Number.isInteger(target.hy)) return;
    if (!terrain.inBounds(target.hx, target.hy)) return;
  } else {
    const t = target.entity;
    if (!Number.isInteger(t) || t === e) return;
    if (!world.isAlive(t) || !world.has(t, Health) || !world.has(t, Position)) return;
    if (!world.has(t, Settler) && !world.has(t, Building) && !world.has(t, Vehicle)) return;
  }
  const live = world.mut(e, Vehicle);
  live.attack = orderedAttack(target);
  live.march = null; // the player's own target ends an attack-move
  if (!crewInside(state)) {
    live.heldGoal = null; // the attack supersedes a goto held for the same boarding
    live.task = 'waitsForHuman';
  } else if (live.task === 'attacks') live.task = 'none';
}
