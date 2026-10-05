import {
  ErectSignpostOrder,
  ExploreOrder,
  isAiPlayer,
  MealBreak,
  MealBreakRetry,
  MoveGoal,
  NoRegeneration,
  OpenChestOrder,
  OrderQueue,
  ownerOf,
  PlayerOrder,
  type QueueableOrderCommand,
  Rider,
  Settler,
  SettlerNeeds,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import {
  carriesNeeds,
  drinkPressingDraughts,
  NEED_CRITICAL_THRESHOLD,
  NEED_DRIVE_THRESHOLD,
  needLevel,
} from '../lifecycle/needs/index.js';
import { clearNavState } from '../movement/nav-state.js';
import { isFighterJob } from '../readviews/index.js';

// Hunger takes a settler off its player orders at the level the HUD marks it, the last stretch before
// it costs hitpoints, so a scout sent along a long run of signposts eats instead of starving on it.
// Fatigue costs nothing and waits for the orders to run out. Named addition: the original checks no
// need while a player's command runs.

/** How long a settler whose meal break found nothing to eat keeps to its orders before hunger may take
 *  it off them again. Approximation: one failed food search per stretch of a long walk, not per node. */
export const MEAL_BREAK_RETRY_TICKS = 20 * TICKS_PER_SECOND;

/**
 * Whether hunger takes `e` off its player orders now. Carried draughts answer first, where it stands. A
 * soldier whose regeneration the player prohibited keeps going, as it never leaves what it does to look
 * for food, and a computer seat's fighter is left to its seat's refill, so a march holds together.
 */
export function breaksForMeal(world: World, ctx: SystemContext, e: Entity): boolean {
  const jobType = world.tryGet(e, Settler)?.jobType ?? null;
  // A jobless settler never starves and the planner never visits it, so nothing would end its break.
  if (jobType === null || world.has(e, Rider) || !carriesNeeds(world, ctx.content, e)) return false;
  drinkPressingDraughts(world, ctx, e);
  if (world.has(e, NoRegeneration) || ctx.tick < (world.tryGet(e, MealBreakRetry)?.retryAt ?? 0))
    return false;
  if (needLevel(world.get(e, SettlerNeeds), 'hunger', ctx.tick) < NEED_CRITICAL_THRESHOLD) return false;
  const owner = ownerOf(world, e);
  return !(owner !== undefined && isAiPlayer(world, owner) && isFighterJob(ctx.content, jobType));
}

/** Hold `e`'s orders while the needs drive feeds it. */
export function startMealBreak(world: World, e: Entity): void {
  world.remove(e, MealBreakRetry);
  world.add(e, MealBreak, { hungry: true });
}

/**
 * Take `e`, walking an order and standing on a node, off it for a meal: the order goes back to the head
 * of its queue, to start afresh once it has eaten, and an explore sweep keeps its own marker and picks
 * its next leg then. The route goes too, so the planner sees the settler free and plans the meal.
 */
export function suspendWalkForMeal(world: World, terrain: TerrainGraph, e: Entity): void {
  const resume = resumableOrder(world, terrain, e);
  if (resume !== null) {
    const queue = world.tryMut(e, OrderQueue);
    if (queue === undefined) world.add(e, OrderQueue, { orders: [resume] });
    else queue.orders.unshift(resume);
  }
  world.remove(e, PlayerOrder);
  world.remove(e, ErectSignpostOrder);
  world.remove(e, OpenChestOrder);
  clearNavState(world, e);
  startMealBreak(world, e);
}

/** The command that starts `e`'s walking order over again, or null for an explore leg. */
function resumableOrder(world: World, terrain: TerrainGraph, e: Entity): QueueableOrderCommand | null {
  if (world.has(e, ExploreOrder)) return null;
  const chest = world.tryGet(e, OpenChestOrder);
  if (chest !== undefined) return { kind: 'openChest', entity: e, chest: chest.chest };
  const signpost = world.tryGet(e, ErectSignpostOrder);
  if (signpost !== undefined) {
    const at = terrain.coordsOf(signpost.goal);
    return { kind: 'placeSignpost', entity: e, x: at.x, y: at.y };
  }
  const march = world.tryGet(e, PlayerOrder)?.attackMove;
  const goal = march?.goal ?? world.tryGet(e, MoveGoal)?.cell;
  if (goal === undefined) return null;
  const at = terrain.coordsOf(goal);
  return { kind: march === undefined ? 'moveUnit' : 'attackMoveUnit', entity: e, x: at.x, y: at.y };
}

/** A walk the player orders during `e`'s meal break calls the break off, and hunger leaves the new orders
 *  alone for {@link MEAL_BREAK_RETRY_TICKS}: the player may be pulling the settler out of danger. */
export function overrideMealBreak(world: World, ctx: SystemContext, e: Entity): void {
  world.remove(e, MealBreak);
  world.add(e, MealBreakRetry, { retryAt: ctx.tick + MEAL_BREAK_RETRY_TICKS });
}

/** End `e`'s meal break, its orders resuming next tick. One that left it hungry, with nothing in reach
 *  to eat, holds off the next break for {@link MEAL_BREAK_RETRY_TICKS}. */
export function endMealBreak(world: World, ctx: SystemContext, e: Entity): void {
  world.remove(e, MealBreak);
  if (needLevel(world.get(e, SettlerNeeds), 'hunger', ctx.tick) >= NEED_DRIVE_THRESHOLD) {
    world.add(e, MealBreakRetry, { retryAt: ctx.tick + MEAL_BREAK_RETRY_TICKS });
  }
}
