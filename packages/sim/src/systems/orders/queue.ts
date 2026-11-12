import type { AiOrderOrigin } from '../../components/ai/order.js';
import {
  AttackOrder,
  BuildMode,
  ClaimAnimalOrder,
  CurrentAtomic,
  DeferredOrder,
  EquipOrder,
  ErectSignpostOrder,
  ExploreOrder,
  hasMissionBehaviour,
  MealBreak,
  MISSION_BEHAVIOUR,
  NeedOrder,
  OpenChestOrder,
  OrderQueue,
  PlayerOrder,
  QUEUEABLE_ORDER_KINDS,
  type QueueableOrderCommand,
  Rider,
  Settler,
  TrainingOrder,
} from '../../components/index.js';
import type { QueuedUnitOrder } from '../../components/settler.js';
import { assertNever } from '../../core/brand.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { pinnedBuildSite } from '../settlers/drives/economy/builder.js';
import { wakeIdle } from '../settlers/planner/idle-replan.js';
import { orderAttachToVehicle, releaseHaulingCart, releasesHaulingCart } from '../vehicles/hauling-cart.js';
import { orderOpenChest } from './chests.js';
import { attackUnit } from './combat.js';
import { equipGood } from './equipment.js';
import { explore } from './explore.js';
import { dropOrderQueue, isOrderableSettler } from './guards.js';
import { orderClaimAnimal } from './livestock.js';
import { breaksForMeal, startMealBreak } from './meal-break.js';
import { attackMoveUnit, moveUnit } from './movement.js';
import { orderNeed } from './needs.js';
import { pushQueuedOrder, queueChangedHands, queuedOrderAuthorized, startQueuedOrders } from './queued.js';
import { placeSignpost } from './signposts.js';
import { trainSoldier } from './training.js';
import { assignBuilder } from './work/employment.js';

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
 * with its closing swing, a strike, a drill or course, a sweep, a need order being answered, a road or
 * wall run, or an order parked behind an atomic; or hunger has taken it off its orders for a meal or a
 * drink of its mead (`meal-break.ts`). The settler's other doings are not waited for: a fight it picked,
 * a breach of its own, or an assistant's errand. A need order nothing answers is dropped by the drive ladder while orders wait
 * (`dropUnservedNeedOrder`). A pinned site holds only the orders queued behind it ({@link holdsFor}).
 */
function holdsCurrentOrder(world: World, e: Entity): boolean {
  if (
    world.has(e, PlayerOrder) ||
    world.has(e, ErectSignpostOrder) ||
    world.has(e, OpenChestOrder) ||
    world.has(e, ClaimAnimalOrder) ||
    world.has(e, TrainingOrder) ||
    world.has(e, ExploreOrder) ||
    world.has(e, DeferredOrder) ||
    world.has(e, MealBreak) ||
    world.has(e, NeedOrder)
  ) {
    return true;
  }
  if (world.tryGet(e, EquipOrder)?.issuer === 'player') return true;
  if (world.has(e, BuildMode)) return true;
  const attack = world.tryGet(e, AttackOrder);
  if (attack !== undefined && attack.breach?.enemy === undefined) return true;
  const effect = world.tryGet(e, CurrentAtomic)?.effect.kind;
  return effect === 'erectSignpost' || effect === 'openChest' || effect === 'drink';
}

/** Whether `e` is held for `next`: by its current order, or by the pinned site `next` was queued behind. */
function holdsFor(world: World, e: Entity, next: QueuedUnitOrder): boolean {
  return (
    holdsCurrentOrder(world, e) ||
    (next.afterSite !== undefined && pinnedBuildSite(world, e) === next.afterSite)
  );
}

/**
 * Line a queued order up behind the settler's current one. True when it was queued (or dropped past
 * `ORDER_QUEUE_LIMIT`); false when the settler has nothing to wait for, or rides a vehicle whose walk
 * orders drive or leave it, so the command applies at once like an unqueued one.
 */
export function queueBehindCurrentOrder(
  world: World,
  command: QueueableOrderCommand,
  origin?: AiOrderOrigin,
): boolean {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || world.has(e, Rider)) return false;
  const order = unqueued(command, origin, siteQueuedBehind(world, e));
  return pushQueuedOrder(world, OrderQueue, e, order, (next) => holdsFor(world, e, next));
}

/** The pinned site an order queued now waits behind: the one the queue's last order pins, or with no queue
 *  the settler's own pin when nothing else holds it. A pin kept through a later walk or strike is the
 *  builder's standing post, not the order ahead. */
function siteQueuedBehind(world: World, e: Entity): Entity | undefined {
  const last = world.tryGet(e, OrderQueue)?.orders.at(-1);
  if (last !== undefined) return last.kind === 'assignBuilder' ? last.site : undefined;
  if (holdsCurrentOrder(world, e)) return undefined;
  return pinnedBuildSite(world, e) ?? undefined;
}

/** A fresh copy without the queue flag: the stored command is component state, the caller's sits in the
 *  replay log. */
function unqueued(
  command: QueueableOrderCommand,
  origin?: AiOrderOrigin,
  afterSite?: Entity,
): QueuedUnitOrder {
  const { queued: _queued, ...order } = command;
  return {
    ...order,
    ...(origin === undefined ? {} : { aiOrder: { ...origin } }),
    ...(afterSite === undefined ? {} : { afterSite }),
  };
}

/**
 * Start each settler's next queued order once its current one is done. Scheduled after the order systems
 * that retire an arrived walk or turn it into its errand, and before the planner, so an arrival walks on
 * the same tick instead of being re-tasked. The needs drive gets no tick between two legs, except a meal
 * break that holds the queue until the settler has eaten (`meal-break.ts`). An order refused at its start
 * is skipped for the next one. A settler aboard a vehicle, one a script took out of the player's hands, or
 * one handed to another player drops its queue.
 */
export const orderQueueSystem: System = (world, ctx) => {
  // Collected first: putting the rest back re-adds the component under the query.
  for (const e of [...world.query(Settler, OrderQueue)]) {
    if (
      world.has(e, Rider) ||
      hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE) ||
      queueChangedHands(world, OrderQueue, e)
    ) {
      dropOrderQueue(world, e);
      continue;
    }
    const next = world.get(e, OrderQueue).orders[0];
    if (next === undefined || holdsFor(world, e, next)) continue;
    if (breaksForMeal(world, ctx, e)) {
      startMealBreak(world, e);
      continue;
    }
    // A settler that boarded a vehicle starts nothing more: its queue lapses on the next pass.
    startQueuedOrders(
      world,
      OrderQueue,
      e,
      (following) => world.has(e, Rider) || holdsFor(world, e, following),
      (order, owner) => startQueuedOrder(world, ctx, order, owner),
    );
  }
};

/** A started order wakes an idle settler the way an order applied by the command pass does, so a need
 *  order is planned this tick rather than on the settler's next re-plan beat. */
function startQueuedOrder(world: World, ctx: SystemContext, queued: QueuedUnitOrder, owner: number): void {
  const { aiOrder: origin, afterSite: _afterSite, ...command } = queued;
  if (!queuedOrderAuthorized(world, ctx, command, origin, owner)) return;
  wakeIdle(world, command.entity);
  if (releasesHaulingCart(command)) releaseHaulingCart(world, ctx, command.entity);
  switch (command.kind) {
    case 'moveUnit':
      moveUnit(world, ctx, command, origin);
      return;
    case 'attackMoveUnit':
      attackMoveUnit(world, ctx, command, origin);
      return;
    case 'attackUnit':
      attackUnit(world, ctx, command, origin);
      return;
    case 'placeSignpost':
      placeSignpost(world, ctx, command, origin);
      return;
    case 'openChest':
      orderOpenChest(world, ctx, command);
      return;
    case 'claimAnimal':
      orderClaimAnimal(world, ctx, command);
      return;
    case 'equipGood':
      equipGood(world, ctx, command);
      return;
    case 'orderNeed':
      orderNeed(world, ctx, command);
      return;
    case 'explore':
      explore(world, ctx, command);
      return;
    case 'assignBuilder':
      assignBuilder(world, ctx, command);
      return;
    case 'trainSoldier':
      trainSoldier(world, ctx, command);
      return;
    case 'attachToVehicle':
      orderAttachToVehicle(world, ctx, command);
      return;
    default:
      assertNever(command);
  }
}
