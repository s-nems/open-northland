import type { BuildingFootprint, BuildingType, GoodQuantity } from '@open-northland/data';

/**
 * The `[GfxHouse]` graphics-table fields keyed by building `typeId`. The logic house table carries none
 * of them.
 */
export interface BuildingGraphicsOverlays {
  readonly constructionCosts: ReadonlyMap<number, GoodQuantity[]>;
  /** Building `typeId` → max hitpoints. */
  readonly hitpoints: ReadonlyMap<number, number>;
  /** Building `typeId` → the next size level's `typeId`. */
  readonly upgradeTargets: ReadonlyMap<number, number>;
  readonly footprints: ReadonlyMap<number, BuildingFootprint>;
}

/**
 * Joins the graphics-table overlays onto the logic buildings by `typeId`. A building the graphics table
 * omits keeps its schema defaults, which leaves it with no hitpoints, upgrade target, or collision.
 */
export function applyBuildingGraphicsOverlays(
  buildings: readonly BuildingType[],
  overlays: BuildingGraphicsOverlays,
): BuildingType[] {
  return buildings.map((b) => {
    const cost = overlays.constructionCosts.get(b.typeId);
    const hp = overlays.hitpoints.get(b.typeId);
    const upgradeTarget = overlays.upgradeTargets.get(b.typeId);
    const footprint = overlays.footprints.get(b.typeId);
    return {
      ...b,
      ...(cost ? { construction: cost } : {}),
      ...(hp !== undefined ? { hitpoints: hp } : {}),
      ...(upgradeTarget !== undefined ? { upgradeTarget } : {}),
      ...(footprint ? { footprint } : {}),
    };
  });
}
