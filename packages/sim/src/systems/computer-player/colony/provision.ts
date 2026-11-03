import { BUILDING_KIND } from '@open-northland/data';
import { Building, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isEdibleFoodIn, isFisherJob, isHunterJob } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { stockAtBuildings } from '../../stores/index.js';
import {
  knownAnd,
  knownResourceTest,
  nearestLiveResource,
  reachableResourceTest,
  type WorkableTest,
  workableResourceTest,
} from '../live-resources.js';
import { collectorSpot, type FlagGround, flagGround } from '../workforce/flag-spots.js';
import { storedFoodUnits } from '../workforce/food.js';
import { crewAt } from '../workforce/staffing-rows.js';
import type { ColonyEnv, SeatEnv } from './voyage.js';

/** Owner ruling: wood, iron, stone and clay depend on what lies on the colony's land: what it holds never
 *  sails out, what it lacks and needs does. */
export const LAND_GOOD_IDS = ['wood', 'stone', 'mud', 'iron'] as const;
export type LandGood = (typeof LAND_GOOD_IDS)[number];

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

/** Whether the colony's `people` eat well: its stores hold a meal a mouth, or its fishers, hunters and
 *  kitchens at work feed them all. A store eaten down as fast as the catch comes in still feeds them. */
export function colonyFed(env: ColonyEnv, buildings: readonly Entity[], people: readonly Entity[]): boolean {
  if (colonyFoodHeld(env, buildings) >= people.length) return true;
  const { world, ctx } = env;
  const hands = people.filter((e) => {
    const job = world.get(e, Settler).jobType;
    return isFisherJob(ctx.content, job) || (job !== null && isHunterJob(ctx.content, job));
  }).length;
  return MOUTHS_PER_FOOD_HAND * hands + kitchenMouths(env, buildings) >= people.length;
}

/** Whether the land under `from` holds a live deposit of `goodType` the seat knows of. Costs a resource
 *  search, the whole good's on a land that holds none. */
export function landHolds(env: SeatEnv, from: HalfCellNode, goodType: number): boolean {
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

/** The flag ground of the signposts round `origin`. */
export function flagGroundAt(env: ColonyEnv, origin: HalfCellNode): FlagGround {
  const { world, ctx, terrain, seat } = env;
  return flagGround(world, ctx, terrain, networkLimitAt(world, terrain, seat, origin.hx, origin.hy), 'aimed');
}

/** Which of a good's resources `origin`'s men may work: known to the seat and inside its reach. */
export function workableFrom(env: ColonyEnv, origin: HalfCellNode, ground: FlagGround): WorkableTest {
  const { world, ctx, terrain, seat } = env;
  const reachable = reachableResourceTest(
    world,
    ctx,
    terrain,
    origin,
    workableResourceTest(world, ctx, terrain),
  );
  const known = knownResourceTest(world, ctx, seat);
  const door = terrain.nodeAtClamped(origin.hx, origin.hy);
  const { limit } = ground;
  return (e) =>
    reachable(e) &&
    (known === null || known(e)) &&
    (limit === null || limit.allowsNode(interactionCell(world, ctx, terrain, e, door)));
}

/** Whether a flag on `goodType` can stand now: what the land holds past the signposts nobody digs. Costs a
 *  flag search. */
export function canDig(env: ColonyEnv, origin: HalfCellNode, goodType: number, ground: FlagGround): boolean {
  const workable = workableFrom(env, origin, ground);
  return collectorSpot(env.world, ground, origin, goodType, new Set(), workable) !== null;
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
