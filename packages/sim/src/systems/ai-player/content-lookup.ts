import type { BuildingType, ContentSet, GoodType } from '@open-northland/data';
import type { ContentIndex } from '../../core/content-index.js';

/** The building definition carrying the stable content id, or undefined when this content set lacks
 *  it - a module skips such an entry instead of failing. */
export function buildingTypeByContentId(content: ContentSet, id: string): BuildingType | undefined {
  return content.buildings.find((b) => b.id === id);
}

/** The good definition carrying the stable content id, or undefined (same skip contract as
 *  {@link buildingTypeByContentId}). */
export function goodTypeByContentId(content: ContentSet, id: string): GoodType | undefined {
  return content.goods.find((g) => g.id === id);
}

/** The typeIds at or above `target` on its `upgradeTarget` chain: `target` itself plus everything it
 *  upgrades into. The visited guard bounds a malformed cyclic chain. */
export function tiersAtOrAbove(index: ContentIndex, target: BuildingType): Set<number> {
  const tiers = new Set<number>();
  let step: BuildingType | undefined = target;
  while (step !== undefined && !tiers.has(step.typeId)) {
    tiers.add(step.typeId);
    step = step.upgradeTarget === undefined ? undefined : index.buildings.get(step.upgradeTarget);
  }
  return tiers;
}
