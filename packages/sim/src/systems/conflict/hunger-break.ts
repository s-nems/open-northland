import {
  Engagement,
  HuntFocus,
  MealBreak,
  MealBreakRetry,
  NeedOrder,
  PlayerOrder,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { drinkPressingDraughts } from '../lifecycle/needs/index.js';
import { clearNavState } from '../movement/nav-state.js';
import { breaksForMeal, startMealBreak, suspendWalkForMeal } from '../orders/meal-break.js';

/**
 * Whether hunger keeps `e` out of the fight this tick, asked between blows, where the planner never sees a
 * unit that trades them back to back. An engaged unit first drinks what it carries. Then a meal the player
 * ordered, a meal break under way, or critical hunger on a unit allowed to regenerate
 * ({@link breaksForMeal}) hands it to the planner, which walks it to food; an attack-move it was on waits
 * at the head of its queue, an attack order stands. Where nothing in reach feeds it the planner leaves a
 * {@link MealBreakRetry}, and it fights on until that runs out. Named addition, not taken from the
 * original.
 */
export function hungerKeepsFromFight(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
): boolean {
  if (world.has(e, HuntFocus)) return false;
  const engaged = world.has(e, Engagement);
  if (engaged) drinkPressingDraughts(world, ctx, e);
  if (world.tryGet(e, NeedOrder)?.need === 'hunger') {
    const retry = world.tryGet(e, MealBreakRetry);
    if (retry !== undefined && ctx.tick < retry.retryAt) return false;
  } else if (!world.has(e, MealBreak)) {
    const order = world.tryGet(e, PlayerOrder);
    if (!engaged || order?.scripted === true || !breaksForMeal(world, ctx, e)) return false;
    if (order !== undefined) suspendWalkForMeal(world, terrain, e);
    else startMealBreak(world, e);
  }
  if (engaged) {
    world.remove(e, Engagement);
    clearNavState(world, e);
  }
  return true;
}
