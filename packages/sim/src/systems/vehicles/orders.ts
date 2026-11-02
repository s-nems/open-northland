import type { AiOrderOrigin } from '../../components/ai/order.js';
import {
  Building,
  dropVehicleOrderQueue,
  Health,
  Palisade,
  Position,
  Settler,
  Vehicle,
  vehicleCommander,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { orderedAttack, sameTarget } from '../conflict/engage-vehicle.js';
import { vehicleWeapon } from '../conflict/weapons.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { ownersAtPeace } from '../match/peace.js';
import { recordAiOrder } from '../orders/ai-lifecycle.js';
import { crewInside, cutRoute, dropHeldGoal, endMarch, refuseMove, settleAttackTask } from './movement.js';

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
    settleAttackTask(world, e);
  }
}

/**
 * The attack order: an armed, commanded vehicle takes the target and the combat pass closes on it or
 * fires. A crew still outside is boarded first: the order waits under `waitsForHuman`, the twin of the
 * goto's held goal, and the combat pass takes it up once everyone is inside. A clip under way plays
 * on, so repeating or changing the order never restarts the shot. Refused with
 * `vehicleMoveRefused` `noCommander` while nobody commands the vehicle, and by the combat pass with
 * `noPath` when no firing node reaches the target; an unarmed vehicle, a target that is not a unit,
 * house or vehicle, or a map point off the map orders nothing.
 */
export function attackWithVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attackWithVehicle' }>,
  origin?: AiOrderOrigin,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  if (state === undefined || state.carrier !== null || vehicleWeapon(ctx, state) === null) return;
  dropVehicleOrderQueue(world, e);
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
    if (ownersAtPeace(world, e, t)) return;
    const body = world.has(t, Building) || world.has(t, Palisade) || world.has(t, Vehicle);
    if (!body && !world.has(t, Settler)) return;
  }
  recordAiOrder(world, e, origin);
  endMarch(world, e); // the player's own target ends an attack-move
  const held = state.attack;
  const live = world.mut(e, Vehicle);
  live.attack = orderedAttack(target);
  if (!crewInside(state)) {
    dropHeldGoal(world, e); // the attack supersedes a goto held for the same boarding
    live.task = 'waitsForHuman';
    return;
  }
  settleAttackTask(world, e);
  // A drive under way serves the old order: it ends on its next node so the new target is judged there.
  if (held === null || !sameTarget(held.target, target)) cutRoute(world, e);
}
