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
 * The dish goods, by good `id`, and the edible each becomes when carried out of the house producing it.
 *
 * source-basis, evidenced for THREE of the six: `houses.ini` gives bread a `logicstock` slot only in
 * `work bakery 00`/`01`, candy only in `work bakery 01`, and meat only in `work animal farm` — no
 * warehouse, home, barracks or workshop holds one, and no house recipe takes one as an input
 * (`goodtypes.ini` does name meat as sausage's `productionInputGoods`, but no house declares that
 * recipe). The stored forms `food_simple` (16) and `food_extra` (17) are slotted by every larder
 * (headquarters 150, stocks 45/70/120, every home level; barracks and towers carry `food_simple` alone)
 * yet no recipe or `atomicForProduction` makes either.
 *
 * fruit, fish and sausage have NO producer and NO slot anywhere in this content set, so their entries
 * never fire — inference carried for a content set that might declare them. `fruit` is the shakiest:
 * `goodtypes.ini` marks it `isProducedOnMapFlag 1`, a map-harvested good, so "leaves the kitchen" would
 * not describe it. Anything lifted from a store that does not PRODUCE the good stays raw
 * ({@link carriedGoodForm}), which is what keeps a meat heap routable to the animal farm.
 *
 * The simple/extra split is pinned for CANDY: good 17 and good 20 share one display name
 * ("Ciastko"/"Ciastka") in `text/pol/strings/gameobjects/goods.ini`, the eat slots are named for the
 * same pair (`..._eat_slot_food`, `..._eat_slot_candy`), and `atomicanimations.ini` gives the candy clip
 * a second need payout the plain food clip lacks — the luxury food. The other five are `food_simple` by
 * elimination, since no readable rule file states the split
 * (docs/tickets/sim/dish-edible-split-evidence.md).
 */
export const EDIBLE_FORM_BY_DISH: ReadonlyMap<string, string> = new Map([
  ['fruit', 'food_simple'],
  ['bread', 'food_simple'],
  ['candy', 'food_extra'],
  ['meat', 'food_simple'],
  ['fish', 'food_simple'],
  ['sausage', 'food_simple'],
]);

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
 * The edible a dish becomes, or `goodType` unchanged when it is not a dish
 * ({@link EDIBLE_FORM_BY_DISH}).
 *
 * Applying it is where the sim stops conserving good *identity*: the count is conserved (one unit out,
 * one unit on the back), but the bakery's bread leaves as `food_simple`. Without that a dish is a dead
 * end — `stockCapacity` is 0 for it in every store, so routing finds no sink, no carrier ever lifts it,
 * and the kitchen wedges at a full shelf with its workers idle.
 *
 * Scope: this resolves the mapping only. {@link carriedGoodForm} decides WHEN it applies — a lift out of
 * the producing house — and a dish minted straight onto the back (a hunter's meat, `effects-goods/harvest.ts`)
 * bypasses it entirely. See docs/tickets/sim/dish-conversion-at-carry-mint.md.
 */
export function exportedGoodForm(ctx: SystemContext, goodType: number): number {
  return edibleForms(ctx.content).get(goodType) ?? goodType;
}
