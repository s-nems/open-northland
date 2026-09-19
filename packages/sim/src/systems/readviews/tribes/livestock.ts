import type { ContentSet } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

/** The species good of livestock species `tribeType` (its breeding product and herd row), or null for a
 *  non-livestock tribe. */
export function livestockGoodOfTribe(content: ContentSet, tribeType: number): number | null {
  return contentIndex(content).livestockGoodByTribe.get(tribeType) ?? null;
}

/** The livestock species whose herd `goodType` counts, or null for an ordinary good. */
export function livestockTribeOfGood(content: ContentSet, goodType: number): number | null {
  return contentIndex(content).livestockTribeByGood.get(goodType) ?? null;
}

/** Every species good, in content-index order. */
export function livestockSpeciesGoods(content: ContentSet): Iterable<number> {
  return contentIndex(content).livestockTribeByGood.keys();
}

/** A building type carrying a breeding recipe, the farm a claimed herd attaches to. */
export function isLivestockWorkplaceType(content: ContentSet, buildingType: number): boolean {
  return contentIndex(content).livestockWorkplaceTypes.has(buildingType);
}

/** The breeder atomic that slaughters an adult of species good `goodType`, or null without one. */
export function slayAtomicOfSpecies(content: ContentSet, goodType: number): number | null {
  return contentIndex(content).livestockSlayAtomicByGood.get(goodType) ?? null;
}
