import type { ContentSet, Recipe } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

/** The good stocking one FED animal of livestock species `tribeType`, or null for a non-livestock tribe. */
export function livestockGoodOfTribe(content: ContentSet, tribeType: number): number | null {
  return contentIndex(content).livestockGoodByTribe.get(tribeType) ?? null;
}

/** The livestock species whose fed animal `goodType` stocks, or null for an ordinary good. */
export function livestockTribeOfGood(content: ContentSet, goodType: number): number | null {
  return contentIndex(content).livestockTribeByGood.get(goodType) ?? null;
}

/** The livestock species `recipe` feeds, or null for an ordinary (non-feed) recipe. */
export function livestockTribeFedBy(content: ContentSet, recipe: Recipe): number | null {
  const product = recipe.outputs[0]?.goodType;
  return product === undefined ? null : livestockTribeOfGood(content, product);
}

/** A building type carrying a feed recipe, the workplace claimed livestock is herded to. */
export function isLivestockWorkplaceType(content: ContentSet, buildingType: number): boolean {
  return contentIndex(content).livestockWorkplaceTypes.has(buildingType);
}

/** The feed-cycle byproduct, resolved by slug because the sandbox catalog offsets the numeric good id. */
export function livestockMeatGoodOf(content: ContentSet): number | null {
  return contentIndex(content).livestockMeatGood;
}
