import type { BuildingType } from '@open-northland/data';
import { playerPlacementTribes } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { topEnabledTier } from '../top-tier.js';

/** The warehouse a colony founds on. */
export const COLONY_STORE_BUILDING_ID = 'stock_00';

/** The warehouse tier a colony places (owner ruling: level 3, a trader trades from no lower one): the
 *  highest tier of the store chain `seat` has enabled, placed outright; while the top is not yet enabled, the
 *  highest that is, which `liftStore` (`./lifts.ts`) raises to the top later. Undefined for a seat with no tribe or a
 *  content with no store. */
export function colonyStoreType(world: World, ctx: SystemContext, seat: number): BuildingType | undefined {
  const base = buildingTypeByContentId(ctx.content, COLONY_STORE_BUILDING_ID);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  return base === undefined || tribe === undefined
    ? undefined
    : topEnabledTier(world, ctx, seat, tribe, base);
}
