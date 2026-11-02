import { BUILDING_KIND } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { stockAtBuildings } from '../../stores/index.js';
import {
  knownAnd,
  knownResourceTest,
  nearestLiveResource,
  reachableResourceTest,
  workableResourceTest,
} from '../live-resources.js';
import { storedFoodUnits } from '../workforce/food.js';
import type { ColonyEnv } from './voyage.js';

/** Owner ruling: wood, iron, stone and clay depend on what lies on the colony's land: what it holds never
 *  sails out, what it lacks and needs does. */
export const LAND_GOOD_IDS = ['wood', 'stone', 'mud', 'iron'] as const;
export type LandGood = (typeof LAND_GOOD_IDS)[number];

/** What the colony's warehouses hold, those still sites included: they own the ground heaps of a hold set
 *  ashore before a store stands. */
export function storesHeld(env: ColonyEnv, buildings: readonly Entity[]): Map<number, number> {
  const { world, ctx, seat } = env;
  const index = contentIndex(ctx.content);
  const stores = buildings.filter(
    (e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  return stockAtBuildings(world, seat, stores);
}

/** The edible units in the colony's warehouses. */
export function colonyFoodHeld(env: ColonyEnv, buildings: readonly Entity[]): number {
  const held = storesHeld(env, buildings);
  return storedFoodUnits(env.ctx.content, { units: (good) => held.get(good) ?? 0 });
}

/** Whether the land under `from` holds a live deposit of `goodType` the seat knows of. Costs a resource
 *  search, the whole good's on a land that holds none. */
export function landHolds(env: ColonyEnv, from: HalfCellNode, goodType: number): boolean {
  const { world, ctx, terrain, seat } = env;
  const reachable = reachableResourceTest(
    world,
    ctx,
    terrain,
    from,
    workableResourceTest(world, ctx, terrain),
  );
  const known = knownResourceTest(world, ctx, seat);
  return nearestLiveResource(world, goodType, from, knownAnd(known, reachable)) !== null;
}

/** The goods `buildings`, the colony's, make once they stand. */
function workshopGoods(env: ColonyEnv, buildings: readonly Entity[]): Set<number> {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const goods = new Set<number>();
  for (const e of buildings) {
    if (!isBuilt(world, e)) continue;
    const typeId = world.get(e, Building).buildingType;
    const type = index.buildings.get(typeId);
    if (type?.kind !== BUILDING_KIND.workplace) continue;
    for (const good of type.produces) goods.add(good);
    for (const output of index.mergedRecipeByBuilding.get(typeId)?.outputs ?? []) goods.add(output.goodType);
  }
  return goods;
}

/** What never sails out to the colony (owner ruling): what its workshops make and what its land holds. */
export function colonyMakes(
  env: ColonyEnv,
  from: HalfCellNode,
  buildings: readonly Entity[],
): ReadonlySet<number> {
  const goods = workshopGoods(env, buildings);
  for (const id of LAND_GOOD_IDS) {
    const good = goodTypeByContentId(env.ctx.content, id);
    if (good !== undefined && landHolds(env, from, good.typeId)) goods.add(good.typeId);
  }
  return goods;
}
