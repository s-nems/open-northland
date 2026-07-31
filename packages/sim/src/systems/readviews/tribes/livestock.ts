import type { ContentSet } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

// The husbandry read views over the species⇄good join (`content-index/livestock.ts`): a fed animal is
// stocked as a good, the live creature is a `catchable` animal tribe. Capture/regen/anchoring key on
// `isCatchableAnimal` (./animals.ts); these views serve the processing side, which needs the good link.

/** The good stocking one FED animal of livestock species `tribeType`, or null for a non-livestock tribe. */
export function livestockGoodOfTribe(content: ContentSet, tribeType: number): number | null {
  return contentIndex(content).livestockGoodByTribe.get(tribeType) ?? null;
}

/** The livestock species whose fed animal `goodType` stocks, or null for an ordinary good. */
export function livestockTribeOfGood(content: ContentSet, goodType: number): number | null {
  return contentIndex(content).livestockTribeByGood.get(goodType) ?? null;
}

/** Whether building type `buildingType` carries a feed recipe - the workplace claimed livestock is
 *  herded to (the anchor set of the livestock-assignment drive). */
export function isLivestockWorkplaceType(content: ContentSet, buildingType: number): boolean {
  return contentIndex(content).livestockWorkplaceTypes.has(buildingType);
}

/** The feed-cycle byproduct ware - the `meat` good resolved by slug (never the numeric `goodtypes.ini`
 *  id, which the sandbox catalog offsets); null when the content ships no meat good. */
export function livestockMeatGoodOf(content: ContentSet): number | null {
  return contentIndex(content).livestockMeatGood;
}
