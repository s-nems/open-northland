import { BUILDING_KIND } from '@open-northland/data';
import { Building, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isEdibleFoodIn, isFisherJob, isHunterJob } from '../../readviews/index.js';
import { stockAtBuildings } from '../../stores/index.js';
import { storedFoodUnits } from '../workforce/food.js';
import { crewAt } from '../workforce/staffing-rows.js';
import type { ColonyEnv } from './env.js';
import { canDig, flagGroundAt, LAND_GOOD_IDS } from './land.js';

/** What the colony's warehouses hold, those still sites included: they own the ground heaps of a hold set
 *  ashore before a store stands. */
export function storesHeld(env: ColonyEnv, buildings: readonly Entity[]): Map<number, number> {
  const { world, ctx, terrain, seat } = env;
  const index = contentIndex(ctx.content);
  const stores = buildings.filter(
    (e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  const { land } = env.colony;
  return stockAtBuildings(
    world,
    seat,
    stores,
    (at) => terrain.inBounds(at.hx, at.hy) && terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) === land,
  );
}

/** The edible units in the colony's warehouses. */
export function colonyFoodHeld(env: ColonyEnv, buildings: readonly Entity[]): number {
  const held = storesHeld(env, buildings);
  return storedFoodUnits(env.ctx.content, { units: (good) => held.get(good) ?? 0 });
}

/** The mouths one food hand feeds (authored from arabskie_wyspy_wolna_gra_mieszana: six fishers and hunters
 *  brought 3.3 food a game minute and a mouth eats about 0.18, so three by the catch alone; at three no colony
 *  had the men for its mill and bakery, at six a third did and the seats' totals rose past no colony), and a
 *  hand at a kitchen, whose baker made 4.7. */
export const MOUTHS_PER_FOOD_HAND = 6;
export const MOUTHS_PER_KITCHEN_HAND = 30;

/** The mouths the colony's kitchens' crews feed. */
export function kitchenMouths(env: ColonyEnv, buildings: readonly Entity[]): number {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  let mouths = 0;
  for (const e of buildings) {
    const recipe = index.mergedRecipeByBuilding.get(world.get(e, Building).buildingType);
    if (!isBuilt(world, e) || !recipe?.outputs.some((o) => isEdibleFoodIn(ctx.content, o.goodType))) continue;
    mouths += MOUTHS_PER_KITCHEN_HAND * crewAt(world, ctx, e);
  }
  return mouths;
}

/** Whether the colony's `people` and `more` mouths besides eat well: its stores hold a meal a mouth, or its
 *  fishers, hunters and kitchens at work feed them all. A store eaten down as fast as the catch comes in
 *  still feeds them. */
export function colonyFed(
  env: ColonyEnv,
  buildings: readonly Entity[],
  people: readonly Entity[],
  more = 0,
): boolean {
  const mouths = people.length + more;
  if (colonyFoodHeld(env, buildings) >= mouths) return true;
  const { world, ctx } = env;
  const hands = people.filter((e) => {
    const job = world.get(e, Settler).jobType;
    return isFisherJob(ctx.content, job) || (job !== null && isHunterJob(ctx.content, job));
  }).length;
  return MOUTHS_PER_FOOD_HAND * hands + kitchenMouths(env, buildings) >= mouths;
}

/** The goods `buildings`, the colony's, make once they stand. */
export function workshopGoods(env: ColonyEnv, buildings: readonly Entity[]): Set<number> {
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

/** What never sails out to the colony (owner ruling): what its workshops make and what its land gives. A
 *  deposit its flags cannot reach yet gives nothing, or a site could wait for a good no ship brings. */
export function colonyMakes(
  env: ColonyEnv,
  from: HalfCellNode,
  buildings: readonly Entity[],
): ReadonlySet<number> {
  const goods = workshopGoods(env, buildings);
  const flags = flagGroundAt(env, from);
  for (const id of LAND_GOOD_IDS) {
    const good = goodTypeByContentId(env.ctx.content, id);
    if (good !== undefined && canDig(env, from, good.typeId, flags)) goods.add(good.typeId);
  }
  return goods;
}
