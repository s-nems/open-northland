import type {
  BuildingFootprint,
  BuildingTribeVariant,
  BuildingType,
  GoodQuantity,
} from '@open-northland/data';
import type { ByTribe } from '../../decoders/ini.js';

/**
 * The `[GfxHouse]` graphics-table fields keyed by building `typeId`. The logic house table carries none
 * of them.
 */
export interface BuildingGraphicsOverlays {
  readonly constructionCosts: ReadonlyMap<number, GoodQuantity[]>;
  /** Building `typeId` → max hitpoints per tribe. */
  readonly hitpoints: ReadonlyMap<number, ByTribe<number>>;
  /** Building `typeId` → the next size level's `typeId`. */
  readonly upgradeTargets: ReadonlyMap<number, number>;
  readonly footprints: ReadonlyMap<number, ByTribe<BuildingFootprint>>;
}

/** The lowest tribe's entry, the one a type's top-level field carries. */
function lowestTribe<T>(byTribe: ByTribe<T> | undefined): [tribe: number, value: T] | undefined {
  let lowest: [number, T] | undefined;
  for (const entry of byTribe ?? []) if (lowest === undefined || entry[0] < lowest[0]) lowest = entry;
  return lowest;
}

/** Every other tribe's own footprint and hitpoints, ascending by tribe. */
function tribeVariants(
  footprints: ByTribe<BuildingFootprint> | undefined,
  hitpoints: ByTribe<number> | undefined,
): BuildingTribeVariant[] {
  const footprintBase = lowestTribe(footprints)?.[0];
  const hitpointsBase = lowestTribe(hitpoints)?.[0];
  const tribes = new Set([...(footprints?.keys() ?? []), ...(hitpoints?.keys() ?? [])]);
  const variants: BuildingTribeVariant[] = [];
  for (const tribe of [...tribes].filter(Number.isFinite).sort((a, b) => a - b)) {
    const footprint = tribe === footprintBase ? undefined : footprints?.get(tribe);
    const hp = tribe === hitpointsBase ? undefined : hitpoints?.get(tribe);
    if (footprint === undefined && hp === undefined) continue;
    variants.push({
      tribe,
      ...(footprint !== undefined ? { footprint } : {}),
      ...(hp !== undefined ? { hitpoints: hp } : {}),
    });
  }
  return variants;
}

/**
 * Joins the graphics-table overlays onto the logic buildings by `typeId`: the lowest tribe's values on the
 * type itself, every other tribe's in `tribeVariants`. A building the graphics table omits keeps its schema
 * defaults, which leaves it with no hitpoints, upgrade target, or collision.
 */
export function applyBuildingGraphicsOverlays(
  buildings: readonly BuildingType[],
  overlays: BuildingGraphicsOverlays,
): BuildingType[] {
  return buildings.map((b) => {
    const cost = overlays.constructionCosts.get(b.typeId);
    const hitpoints = overlays.hitpoints.get(b.typeId);
    const hp = lowestTribe(hitpoints)?.[1];
    const upgradeTarget = overlays.upgradeTargets.get(b.typeId);
    const footprints = overlays.footprints.get(b.typeId);
    const footprint = lowestTribe(footprints)?.[1];
    const variants = tribeVariants(footprints, hitpoints);
    return {
      ...b,
      ...(cost ? { construction: cost } : {}),
      ...(hp !== undefined ? { hitpoints: hp } : {}),
      ...(upgradeTarget !== undefined ? { upgradeTarget } : {}),
      ...(footprint ? { footprint } : {}),
      ...(variants.length > 0 ? { tribeVariants: variants } : {}),
    };
  });
}
