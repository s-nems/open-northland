import type { BuildingType, ContentSet } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { isBuilt, ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { isEdibleFoodIn } from '../../readviews/index.js';
import type { SeatStock } from '../../stores/index.js';
import type { SeatSupply } from './supply.js';
import type { StaffingTally } from './tally.js';

/** Owner ruling: a seat short of food before its animal farm and bakery produce sends a second and a
 *  third hunter out. */
export const FOOD_SHORTAGE_HUNTERS = 2;

/** The seat runs short of food below this many edible units in store per settler, women and children
 *  included, and has enough again from {@link FOOD_COMFORT_UNITS_PER_SETTLER} (authored: one meal and two
 *  meals a mouth, so a hunter hired at the one line keeps his post until the other). */
export const FOOD_SHORT_UNITS_PER_SETTLER = 1;
export const FOOD_COMFORT_UNITS_PER_SETTLER = 2;

/**
 * The food-shortage hunters the seat keeps beside its opening hunter (owner ruling): up to
 * {@link FOOD_SHORTAGE_HUNTERS} while its store runs short of food, none once a workshop making food (the
 * animal farm, a bakery) has a worker, since the farms feed the seat from then on. A seat fishing near
 * its stores gets none: its fishers (`fisher.ts`) catch more than a hunter. `held` is how many it keeps
 * now, which hold to the comfort line instead of the short one.
 */
export function foodHunters(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  supply: SeatSupply,
  tally: StaffingTally,
  held: number,
  fishing: boolean,
): number {
  if (fishing || foodWorkshopWorks(world, ctx, owned, tally)) return 0;
  const perSettler = held > 0 ? FOOD_COMFORT_UNITS_PER_SETTLER : FOOD_SHORT_UNITS_PER_SETTLER;
  return storedFoodUnits(ctx.content, supply) < ownedSettlers(world, player).length * perSettler
    ? FOOD_SHORTAGE_HUNTERS
    : 0;
}

/** The edible units in `stock`, the summary bar's figure, so food a home already holds does not count. */
export function storedFoodUnits(content: ContentSet, stock: Pick<SeatStock, 'units'>): number {
  let food = 0;
  for (const good of edibleGoods(content)) food += stock.units(good);
  return food;
}

/** Whether a workplace of `type` makes food: a recipe output, or a produced good such as the meat an
 *  animal farm's breeder butchers (`produces`), not the mill's flour. */
function makesFood(ctx: SystemContext, type: BuildingType): boolean {
  const outputs = contentIndex(ctx.content).mergedRecipeByBuilding.get(type.typeId)?.outputs ?? [];
  return (
    outputs.some((o) => isEdibleFoodIn(ctx.content, o.goodType)) ||
    type.produces.some((good) => isEdibleFoodIn(ctx.content, good))
  );
}

/** Whether a workplace of `type` belongs to the food chain: it makes food ({@link makesFood}), or a good a
 *  food chain workplace's recipe takes, as the mill's flour for the bakery and the farm's grain for the
 *  mill and the animal farm. */
export function inFoodChain(ctx: SystemContext, type: BuildingType): boolean {
  return foodChainTypes(ctx).has(type.typeId);
}

const foodChainByContent = new WeakMap<ContentSet, ReadonlySet<number>>();

/** The food chain's workplace types ({@link inFoodChain}), grown upstream to a fixed point:
 *  content-static, so memoized per content. */
function foodChainTypes(ctx: SystemContext): ReadonlySet<number> {
  let chain = foodChainByContent.get(ctx.content);
  if (chain !== undefined) return chain;
  const index = contentIndex(ctx.content);
  const workplaces = ctx.content.buildings.filter((b) => b.kind === 'workplace');
  const types = new Set(workplaces.filter((b) => makesFood(ctx, b)).map((b) => b.typeId));
  const outputsOf = (b: BuildingType): number[] => [
    ...(index.mergedRecipeByBuilding.get(b.typeId)?.outputs ?? []).map((o) => o.goodType),
    ...b.produces,
  ];
  for (let grown = true; grown; ) {
    grown = false;
    const wanted = new Set<number>();
    for (const typeId of types)
      for (const input of index.mergedRecipeByBuilding.get(typeId)?.inputs ?? []) wanted.add(input.goodType);
    for (const b of workplaces) {
      if (types.has(b.typeId) || !outputsOf(b).some((good) => wanted.has(good))) continue;
      types.add(b.typeId);
      grown = true;
    }
  }
  chain = types;
  foodChainByContent.set(ctx.content, chain);
  return chain;
}

/** Whether any built workplace among `owned` makes food ({@link makesFood}). */
export function foodWorkshopBuilt(world: World, ctx: SystemContext, owned: readonly Entity[]): boolean {
  const index = contentIndex(ctx.content);
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type?.kind === 'workplace' && isBuilt(world, e) && makesFood(ctx, type)) return true;
  }
  return false;
}

/** Whether a built workplace that makes food ({@link makesFood}) employs anybody. */
function foodWorkshopWorks(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  tally: StaffingTally,
): boolean {
  const index = contentIndex(ctx.content);
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type?.kind !== 'workplace' || !isBuilt(world, e) || !makesFood(ctx, type)) continue;
    for (const count of tally.get(e)?.values() ?? []) if (count > 0) return true;
  }
  return false;
}

const edibleGoodsCache = new WeakMap<ContentSet, readonly number[]>();

/** Every good a settler can eat, the dishes before their conversion included. */
function edibleGoods(content: ContentSet): readonly number[] {
  let goods = edibleGoodsCache.get(content);
  if (goods === undefined) {
    goods = content.goods.filter((g) => isEdibleFoodIn(content, g.typeId)).map((g) => g.typeId);
    edibleGoodsCache.set(content, goods);
  }
  return goods;
}
