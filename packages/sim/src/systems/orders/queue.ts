import {
  AttackOrder,
  CurrentAtomic,
  DeferredOrder,
  EquipOrder,
  ErectSignpostOrder,
  ExploreOrder,
  hasMissionBehaviour,
  MealBreak,
  MISSION_BEHAVIOUR,
  OpenChestOrder,
  ORDER_QUEUE_LIMIT,
  OrderQueue,
  PlayerOrder,
  QUEUEABLE_ORDER_KINDS,
  type QueueableOrderCommand,
  Rider,
  Settler,
  TrainingOrder,
} from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { orderOpenChest } from './chests.js';
import { dropOrderQueue, isOrderableSettler } from './guards.js';
import { breaksForMeal, startMealBreak } from './meal-break.js';
import { attackMoveUnit, moveUnit } from './movement.js';
import { placeSignpost } from './signposts.js';

const QUEUEABLE_KINDS: ReadonlySet<Command['kind']> = new Set(QUEUEABLE_ORDER_KINDS);

function isQueueableOrder(command: Command): command is QueueableOrderCommand {
  return QUEUEABLE_KINDS.has(command.kind);
}

/** Whether `command` asks to wait behind the settler's current order. */
export function isQueuedOrder(command: Command): command is QueueableOrderCommand {
  return isQueueableOrder(command) && command.queued === true;
}

/**
 * Whether `e` is carrying out an order the player gave that ends on its own: a walk or march, an errand
 * with its closing swing, a strike, a drill or course, a sweep, or an order parked behind an atomic; or
 * hunger has taken it off its orders for a meal. The settler's other doings are not waited for: a fight
 * it picked, a breach of its own, an assistant's errand, or a need order, which stands unanswered while
 * the settler works when nothing answers the need.
 */
function holdsCurrentOrder(world: World, e: Entity): boolean {
  if (
    world.has(e, PlayerOrder) ||
    world.has(e, ErectSignpostOrder) ||
    world.has(e, OpenChestOrder) ||
    world.has(e, TrainingOrder) ||
    world.has(e, ExploreOrder) ||
    world.has(e, DeferredOrder) ||
    world.has(e, MealBreak)
  ) {
    return true;
  }
  if (world.tryGet(e, EquipOrder)?.issuer === 'player') return true;
  const attack = world.tryGet(e, AttackOrder);
  if (attack !== undefined && attack.breach?.enemy === undefined) return true;
  const effect = world.tryGet(e, CurrentAtomic)?.effect.kind;
  return effect === 'erectSignpost' || effect === 'openChest';
}

/**
 * Line a queued order up behind the settler's current one. True when it was queued (or dropped past
 * {@link ORDER_QUEUE_LIMIT}); false when the settler has nothing to wait for, or rides a vehicle whose
 * walk orders drive or leave it, so the command applies at once like an unqueued one.
 */
export function queueBehindCurrentOrder(world: World, command: QueueableOrderCommand): boolean {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || world.has(e, Rider)) return false;
  const queue = world.tryMut(e, OrderQueue);
  if (queue === undefined) {
    if (!holdsCurrentOrder(world, e)) return false;
    world.add(e, OrderQueue, { orders: [unqueued(command)] });
  } else if (queue.orders.length < ORDER_QUEUE_LIMIT) {
    queue.orders.push(unqueued(command));
  }
  return true;
}

/** A fresh copy without the queue flag: the stored command is component state, the caller's sits in the
 *  replay log. */
function unqueued(command: QueueableOrderCommand): QueueableOrderCommand {
  const { queued: _queued, ...order } = command;
  return order;
}

/**
 * Start each settler's next queued order once its current one is done. Scheduled after the order systems
 * that retire an arrived walk or turn it into its errand, and before the planner, so an arrival walks on
 * the same tick instead of being re-tasked. The needs drive gets no tick between two legs, except a meal
 * break that holds the queue until the settler has eaten (`meal-break.ts`). An order refused at its start
 * is skipped for the next one. A settler aboard a vehicle, or one a script took out of the player's hands,
 * drops its queue.
 *
 * A started order supersedes the queue as any order does, so the rest is taken off first and put back.
 */
export const orderQueueSystem: System = (world, ctx) => {
  // Collected first: putting the rest back re-adds the component under the query.
  for (const e of [...world.query(Settler, OrderQueue)]) {
    if (world.has(e, Rider) || hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)) {
      dropOrderQueue(world, e);
      continue;
    }
    if (holdsCurrentOrder(world, e)) continue;
    if (breaksForMeal(world, ctx, e)) {
      startMealBreak(world, e);
      continue;
    }
    const pending = [...world.get(e, OrderQueue).orders];
    world.remove(e, OrderQueue);
    let next = pending.shift();
    while (next !== undefined) {
      startQueuedOrder(world, ctx, next);
      if (holdsCurrentOrder(world, e)) break;
      next = pending.shift();
    }
    if (pending.length > 0) world.add(e, OrderQueue, { orders: pending });
  }
};

function startQueuedOrder(world: World, ctx: SystemContext, command: QueueableOrderCommand): void {
  switch (command.kind) {
    case 'moveUnit':
      moveUnit(world, ctx, command);
      return;
    case 'attackMoveUnit':
      attackMoveUnit(world, ctx, command);
      return;
    case 'placeSignpost':
      placeSignpost(world, ctx, command);
      return;
    case 'openChest':
      orderOpenChest(world, ctx, command);
      return;
    default:
      assertNever(command);
  }
}
