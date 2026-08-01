import type { BuildingFootprint, BuildingType, GoodQuantity } from '@open-northland/data';

/**
 * The graphics-table (`[GfxHouse]`) overlays keyed by building `typeId`, applied onto the logic-table
 * buildings by {@link applyBuildingGraphicsOverlays}. The logic table carries none of them - cost,
 * hitpoints, level chain, and footprint all live only in the graphics twin (see the `extract*`
 * producers in `decoders/ini/buildings-gfx`).
 */
export interface BuildingGraphicsOverlays {
  /** typeId → build-material cost (repeat-encoded goods folded to quantities). */
  readonly constructionCosts: ReadonlyMap<number, GoodQuantity[]>;
  /** typeId → max hitpoints (the full life pool the ConstructionSystem ramps up as the building rises). */
  readonly hitpoints: ReadonlyMap<number, number>;
  /** typeId → the next size level's typeId in the same record (the level-chain join). */
  readonly upgradeTargets: ReadonlyMap<number, number>;
  /** typeId → ground footprint (collision body / build-exclusion zone / door). */
  readonly footprints: ReadonlyMap<number, BuildingFootprint>;
}

/**
 * Overlays every {@link BuildingGraphicsOverlays} member onto the logic-table {@link BuildingType}s,
 * joined by `typeId`. A building the graphics table omits keeps its schema-default empty cost and no
 * hitpoints/upgrade target/footprint (it places with no collision - the pre-footprint behavior).
 * Pure - the maps are gathered by the caller during the source scan.
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
