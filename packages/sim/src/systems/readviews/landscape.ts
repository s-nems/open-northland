import type { ContentSet, LandscapeType } from '@open-northland/data';

// `landscapetypes.ini` `allowedon{land,water,everything}`, placement-side only: whether a cell is water is
// the map tile grid's terrain valency.

/** `allowedonwater`, carried by exactly the three wall and gate structures in the real table. */
export function isWaterLayerType(type: LandscapeType): boolean {
  return type.allowedOnWater;
}

/** Sorted ascending by `typeId`, so enumeration does not depend on declaration order. */
export function waterLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isWaterLayerType).sort((a, b) => a.typeId - b.typeId);
}

/** `allowedoneverything`, carried by exactly the `void` passable-empty-terrain type in the real table. */
export function isUniversalLayerType(type: LandscapeType): boolean {
  return type.allowedOnEverything;
}

/** Sorted ascending by `typeId`. */
export function universalLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isUniversalLayerType).sort((a, b) => a.typeId - b.typeId);
}

/**
 * `allowedonland`, carried by 86 of the real table's 87 rows, the exception being `void`. Distinct from
 * `walkable`: a tree or a wall is land-layer yet not walkable.
 */
export function isLandLayerType(type: LandscapeType): boolean {
  return type.allowedOnLand;
}

/** Sorted ascending by `typeId`. */
export function landLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isLandLayerType).sort((a, b) => a.typeId - b.typeId);
}
