import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { operatorRecipes } from '../../settlers/drives/economy/workshop/supply.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';
import { DEFAULT_BUILD_ORDER } from '../build-order/order/default-order.js';
import { seatBuildOrder } from '../build-order/order/seat-order.js';
import { computerProfileOf } from '../difficulty.js';
import { FOOD_COMFORT_UNITS_PER_SETTLER, storedFoodUnits } from '../workforce/food.js';
import { SeatSupply } from '../workforce/supply.js';
import type { SeatEnv } from './env.js';
import { homeStockOf } from './stock.js';

/** The edible class food travels as between home and a colony. */
export const FOOD_GOOD_ID = 'food_simple';

export function foodGood(ctx: SystemContext): number | null {
  return goodTypeByContentId(ctx.content, FOOD_GOOD_ID)?.typeId ?? null;
}

/** The seat's supply at home, its colonies left out. */
export function homeSupply(env: SeatEnv): SeatSupply {
  const { world, ctx, seat } = env;
  const order = seatBuildOrder(world, ctx, seat, DEFAULT_BUILD_ORDER, computerProfileOf(world, seat));
  return SeatSupply.of(world, ctx, seat, homeBuildings(world, ctx, seat), order);
}

/** What home can give of `good` and stay at its comfort line; food at its comfort per settler. */
export function homeSpare(env: SeatEnv, supply: SeatSupply): (good: number) => number {
  const { world, ctx, seat } = env;
  const food = foodGood(ctx);
  const mouths = homeSettlers(world, ctx, seat).length;
  return (good) => {
    if (good === food) {
      const stored = storedFoodUnits(ctx.content, homeStockOf(world, ctx, seat));
      return Math.max(0, stored - FOOD_COMFORT_UNITS_PER_SETTLER * mouths);
    }
    const lines = supply.lines(good);
    const surplus = supply.surplus(good);
    return lines === undefined || surplus === undefined
      ? supply.units(good)
      : Math.max(0, surplus - lines.comfort);
  };
}

/** The input shelves of `buildings`' built workshops, summed by good: what they draw on to keep working.
 *  Only the inputs of what their crews are set to make, so a mint making coins draws no long bow. */
export function workshopShelves(
  env: Pick<SeatEnv, 'world' | 'ctx'>,
  buildings: readonly Entity[],
): Map<number, number> {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const shelves = new Map<number, number>();
  for (const e of buildings) {
    if (!isBuilt(world, e)) continue;
    const capacity = index.stockSlotCapacityByBuilding.get(world.get(e, Building).buildingType);
    const inputs = new Set<number>();
    for (const worker of assignedWorkers(world, e))
      for (const recipe of operatorRecipes(world, ctx, e, worker))
        for (const input of recipe.inputs) inputs.add(input.goodType);
    for (const good of inputs) shelves.set(good, (shelves.get(good) ?? 0) + (capacity?.get(good) ?? 0));
  }
  return shelves;
}
