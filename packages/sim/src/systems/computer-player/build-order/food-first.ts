import { BUILDING_KIND } from '@open-northland/data';
import type { Entity, World } from '../../../ecs/world.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { inFoodChain } from '../workforce/food.js';
import type { BuildOrderEntry } from './entries.js';
import { housingStage } from './housing.js';

/**
 * Whether the seat's food production is missing (owner ruling: food production comes before the population,
 * the weapons and the joiner): no bakery stands and no fisher fishes, the housing lane's `opening` and
 * `herding` stages. Such a seat gives the first building of each food chain kind it lacks the free site
 * ahead of the towers, a barracks not yet due and the other crafts (`./index.ts`). Stored food is no
 * signal here: a growing seat eats its store empty while its bakeries run.
 */
export function seatFoodFailing(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): boolean {
  const stage = housingStage(world, ctx, player, owned);
  return stage === 'opening' || stage === 'herding';
}

/** Whether `entry` places or upgrades a food chain workplace: a maker of food, or of a good one takes
 *  (`../workforce/food.ts`), as the farm, the mill, a well or the brewery. */
export function foodChainStep(ctx: SystemContext, entry: BuildOrderEntry): boolean {
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return false;
  const type = buildingTypeByContentId(ctx.content, entry.building);
  return type !== undefined && type.kind === BUILDING_KIND.workplace && inFoodChain(ctx, type);
}
