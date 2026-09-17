import type { ContentContext } from '../context.js';
import { edibleClassOf, edibleGoodFormOf } from '../readviews/food.js';

/**
 * Whether `good` answers for `wanted` in a trade: the same good, or a dish of the same edible class
 * when the agreement names an edible (reading: the original matches `food_simple`/`food_extra` demands
 * against any simple or extra food). The cart holds dishes in their edible form, so a carried unit
 * compares through that form too.
 */
export function sameFoodClass(ctx: ContentContext, good: number, wanted: number): boolean {
  if (good === wanted) return true;
  const edibleGood = edibleGoodFormOf(ctx.content, good);
  const edibleWanted = edibleGoodFormOf(ctx.content, wanted);
  if (edibleGood !== edibleWanted) return false;
  return edibleClassOf(ctx.content, edibleWanted).length > 0;
}
