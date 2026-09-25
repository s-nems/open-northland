import { BUILDING_KIND, type ContentSet } from '@open-northland/data';
import { Building } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** Matches the eat-slot goods `food_simple`/`food_extra`, and not the separate `potion_food_*` line. */
const FOOD_GOOD_ID_PREFIX = 'food_';

/**
 * The food a hungry settler consumes to reset its hunger. The eat slot
 * (`setatomic <job> 10 "..._eat_slot_food"`) consumes `goodtypes.ini` types 16 and 17.
 *
 * Approximation: `goodtypes.ini` carries no edible flag, so the slot goods are identified by the
 * source's own `food_` id prefix rather than by a decoded slot-to-good binding.
 */
export function isFood(ctx: SystemContext, goodType: number): boolean {
  return isFoodIn(ctx.content, goodType);
}

/** {@link isFood} for a caller that holds a content set but no {@link SystemContext}. */
export function isFoodIn(content: ContentSet, goodType: number): boolean {
  const good = contentIndex(content).goods.get(goodType);
  if (good === undefined) return false;
  return good.id.startsWith(FOOD_GOOD_ID_PREFIX);
}

/** Whether `good` is food in a home, which is never taken back out of it: original behavior of the
 *  trader, and the rule a vehicle's hold keeps too (owner's choice). */
export function isFoodKeptAtHome(world: World, ctx: SystemContext, house: Entity, good: number): boolean {
  const type = world.tryGet(house, Building)?.buildingType;
  return (
    type !== undefined &&
    isFood(ctx, good) &&
    contentIndex(ctx.content).buildings.get(type)?.kind === BUILDING_KIND.home
  );
}

/**
 * The dish goods, by good `id`, and the edible each becomes when carried out of the house producing it.
 *
 * Evidence for three of the six: `houses.ini` slots bread only in `work bakery 00`/`01`, candy only in
 * `work bakery 01`, and meat only in `work animal farm`, while `food_simple` (16) and `food_extra` (17)
 * are slotted by every larder yet made by no recipe. fruit, fish and sausage have no producer and no
 * slot in this content set, so their entries never fire.
 *
 * The split is pinned for candy: goods 17 and 20 share one display name in
 * `text/pol/strings/gameobjects/goods.ini`, the eat slots are named for the same pair
 * (`..._eat_slot_food`, `..._eat_slot_candy`), and `atomicanimations.ini` gives the candy clip a second
 * need payout. Approximation: the other five are `food_simple` by elimination.
 */
export const EDIBLE_FORM_BY_DISH: ReadonlyMap<string, string> = new Map([
  ['fruit', 'food_simple'],
  ['bread', 'food_simple'],
  ['candy', 'food_extra'],
  ['meat', 'food_simple'],
  ['fish', 'food_simple'],
  ['sausage', 'food_simple'],
]);

/** Resolved `dish goodType -> edible goodType`. A dish whose edible form is absent from the content
 *  set is left out, so the lookup returns it unchanged. */
const edibleFormCache = new WeakMap<ContentSet, ReadonlyMap<number, number>>();

function edibleForms(content: ContentSet): ReadonlyMap<number, number> {
  let forms = edibleFormCache.get(content);
  if (forms === undefined) {
    const typeById = new Map(content.goods.map((g) => [g.id, g.typeId]));
    forms = new Map(
      content.goods.flatMap((dish) => {
        const edibleId = EDIBLE_FORM_BY_DISH.get(dish.id);
        const edible = edibleId === undefined ? undefined : typeById.get(edibleId);
        return edible === undefined ? [] : [[dish.typeId, edible] as const];
      }),
    );
    edibleFormCache.set(content, forms);
  }
  return forms;
}

/**
 * The edible a dish becomes, or `goodType` unchanged when it is not a dish. Applying it conserves the
 * unit count but not the good's identity: the bakery's bread leaves as `food_simple`, since only its
 * producing house slots the dish. This resolves the mapping only; the carry seams decide when a lift or a
 * deposit applies it.
 */
export function exportedGoodForm(ctx: SystemContext, goodType: number): number {
  return edibleGoodFormOf(ctx.content, goodType);
}

/** {@link exportedGoodForm} for a caller that holds a content set but no {@link SystemContext}. */
export function edibleGoodFormOf(content: ContentSet, goodType: number): number {
  return edibleForms(content).get(goodType) ?? goodType;
}

const NO_GOODS: readonly number[] = Object.freeze([]);

/** Resolved `edible goodType -> the goods that count as it`: the edible first, then the dishes that
 *  become it, ascending by typeId. */
const edibleClassCache = new WeakMap<ContentSet, ReadonlyMap<number, readonly number[]>>();

function edibleClasses(content: ContentSet): ReadonlyMap<number, readonly number[]> {
  let classes = edibleClassCache.get(content);
  if (classes === undefined) {
    const built = new Map<number, number[]>();
    for (const good of content.goods) {
      if (good.id.startsWith(FOOD_GOOD_ID_PREFIX)) built.set(good.typeId, []);
    }
    for (const [dish, edible] of edibleForms(content)) {
      let dishes = built.get(edible);
      if (dishes === undefined) {
        dishes = [];
        built.set(edible, dishes);
      }
      dishes.push(dish);
    }
    for (const [edible, dishes] of built) {
      dishes.sort((a, b) => a - b);
      dishes.unshift(edible);
    }
    classes = built;
    edibleClassCache.set(content, classes);
  }
  return classes;
}

/** The goods a store answers a demand for `edible` with, the edible itself before the dishes that
 *  become it; empty for a good that is no edible. */
export function edibleClassOf(content: ContentSet, edible: number): readonly number[] {
  return edibleClasses(content).get(edible) ?? NO_GOODS;
}
