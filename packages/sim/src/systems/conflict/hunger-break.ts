import {
  CurrentAtomic,
  Engagement,
  HuntFocus,
  IdleStand,
  MealBreak,
  MealBreakRetry,
  NeedOrder,
  PlayerOrder,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { drinkPressingDraughts, NEED_DRIVE_THRESHOLD, stopToDrink } from '../lifecycle/needs/index.js';
import { clearNavState, isTravelling, onNodeCentre } from '../movement/nav-state.js';
import { breaksForMeal, startMealBreak, suspendWalkForMeal } from '../orders/meal-break.js';

/**
 * Whether hunger keeps `e` out of the fight this tick, asked between blows, where the planner never sees a
 * unit that trades them back to back. An engaged unit first drinks what it carries, stopping where it
 * stands for mead. Then critical hunger on a unit allowed to regenerate ({@link breaksForMeal}) starts a
 * meal break, an attack-move it was on waiting at the head of its queue; and a meal break or a meal the
 * player ordered hands the unit to the planner, which walks it to food. Where nothing in reach feeds it the planner leaves a
 * {@link MealBreakRetry}, and it fights on until that runs out. An engaged unit is asked on a node, so the
 * break leaves it on the lattice; one the planner already stood idle or laid down is the fight's, since
 * nothing is feeding it. Named addition, not taken from the original.
 */
export function hungerKeepsFromFight(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
): boolean {
  if (world.has(e, HuntFocus)) return false;
  const engaged = world.has(e, Engagement);
  if (engaged) {
    if (isTravelling(world, e) && !onNodeCentre(world, e)) return false;
    drinkPressingDraughts(world, ctx, e);
    // Mead is drunk on the eat clip where the unit stands, the fight waiting out the clip.
    if (stopToDrink(world, ctx, e, NEED_DRIVE_THRESHOLD)) {
      clearNavState(world, e);
      return true;
    }
  } else if (world.has(e, IdleStand) || world.has(e, CurrentAtomic)) {
    return false;
  }
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
