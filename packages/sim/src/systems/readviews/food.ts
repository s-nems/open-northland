import type { ContentSet } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import type { SystemContext } from '../context.js';

/** The good-`id` prefix identifying the eat-slot food goods (`food_simple`/`food_extra`) — see
 *  {@link isFood} for the source basis of this inference. */
const FOOD_GOOD_ID_PREFIX = 'food_';

/**
 * Whether a good is **edible** — the food a hungry settler consumes to reset its hunger (the `eat`
 * atomic's target good). In the original, the eat slot (`setatomic <job> 10 "..._eat_slot_food"`)
 * consumes the `food_simple`/`food_extra` goods (`goodtypes.ini` types 16/17); there is no explicit
 * "iseatable" flag in `goodtypes.ini`, so the slot-food goods are identified by the good's `id`
 * carrying the `food` prefix (the source's own naming — `food_simple`/`food_extra`). (`potion_food_*`
 * are a separate potion-consumable mechanic, not the eat slot, so the `food_`-prefix match excludes
 * them by construction.)
 *
 * source-basis (approximated — see source basis): the eat atomic id (10) is pinned to the original's
 * `setatomic` bindings, but *which goods feed* is inferred from the slug rather than a source flag
 * (the original maps the food goods to the eat slot at a level not in the readable rule files). Refine
 * to a content flag if the slot→good binding is later decoded. Cross-system: the AI eat-drive planner
 * uses it to find food (carried or stored); the AtomicSystem consumes one unit on completion.
 */
export function isFood(ctx: SystemContext, goodType: number): boolean {
  const good = contentIndex(ctx.content).goods.get(goodType);
  if (good === undefined) return false;
  return good.id.startsWith(FOOD_GOOD_ID_PREFIX);
}

/**
 * The dish goods, by good `id`, and the edible each becomes once it leaves the kitchen that made it.
 *
 * source-basis: `goodtypes.ini` declares these six alongside `food_simple`/`food_extra`, but
 * `houses.ini` gives them a `logicstock` slot ONLY in their own producing house (bread and candy in
 * `work bakery 00`/`01`, meat in `work animal farm`) — no warehouse, home, barracks or workshop can
 * hold one, and no house recipe takes one as an input. (`goodtypes.ini` does list meat as sausage's
 * `productionInputGoods`, but no house declares that recipe, so nothing ever hauls a dish to a
 * consumer.) The stored forms are `food_simple` (16) and `food_extra` (17),
 * which every store carries (headquarters 150, stocks 45/70/120, every home level) yet no recipe or
 * `atomicForProduction` ever makes. So a dish only ever exists inside its kitchen, and becomes an
 * edible on the way out.
 *
 * The simple/extra split is pinned to the string table (`text/pol/strings/gameobjects/goods.ini`):
 * good 17 and good 20 share one display name ("Ciastko"/"Ciastka") while 16 is the generic term for
 * everything else, and the eat slots are named for the same pair (`..._eat_slot_food` = atomic 10,
 * `..._eat_slot_candy` = atomic 11). Candy is therefore the `food_extra` dish and the other five are
 * `food_simple`.
 */
const EDIBLE_FORM_BY_DISH: Readonly<Record<string, string>> = {
  fruit: 'food_simple',
  bread: 'food_simple',
  candy: 'food_extra',
  meat: 'food_simple',
  fish: 'food_simple',
  sausage: 'food_simple',
};

/** Resolved `dish goodType → edible goodType` per content set. Pure derived data over immutable
 *  content, cached the way {@link contentIndex} caches its own maps. A dish whose edible form is
 *  absent from the content set is left out, so {@link exportedGoodForm} returns it unchanged. */
const edibleFormCache = new WeakMap<ContentSet, ReadonlyMap<number, number>>();

function edibleForms(content: ContentSet): ReadonlyMap<number, number> {
  let forms = edibleFormCache.get(content);
  if (forms === undefined) {
    const typeById = new Map(content.goods.map((g) => [g.id, g.typeId]));
    forms = new Map(
      content.goods.flatMap((dish) => {
        const edible = typeById.get(EDIBLE_FORM_BY_DISH[dish.id] ?? '');
        return edible === undefined ? [] : [[dish.typeId, edible] as const];
      }),
    );
    edibleFormCache.set(content, forms);
  }
  return forms;
}

/**
 * The good a settler ends up carrying when it lifts one unit of `goodType` out of a store — a **dish**
 * ({@link EDIBLE_FORM_BY_DISH}) turns into its edible form, every other good is carried as itself.
 *
 * This is the one place the sim stops conserving good *identity*: the count is conserved (one unit out,
 * one unit on the back), but the bakery's bread leaves as `food_simple`. Without it a dish is a dead
 * end — `stockCapacity` is 0 for it in every store, so routing finds no sink, no carrier ever lifts it,
 * and the kitchen wedges at a full shelf with its workers idle. Callers pair up: the pickup rungs probe
 * routing through this mapping before lifting ({@link deliverableGoodProbe}), and `pickupFromStore`
 * applies it when the swing completes, so plan and effect agree on what is being carried.
 */
export function exportedGoodForm(ctx: SystemContext, goodType: number): number {
  return edibleForms(ctx.content).get(goodType) ?? goodType;
}
