import {
  type BuildingFootprint,
  type BuildingRecordFootprint,
  type BuildingTribeVariant,
  type BuildingType,
  buildingFootprintFor,
  type GoodQuantity,
  sameFootprintCells,
} from '@open-northland/data';
import type { ByTribe, RecordFootprint } from '@open-northland/formats/ini';

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
  /** Building `typeId` → every named record's own footprint. */
  readonly recordFootprints: ReadonlyMap<number, readonly RecordFootprint[]>;
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

/** The named records of `type` that stand on another footprint than their tribe's default, ascending by
 *  tribe, then name. */
function recordFootprints(
  type: Pick<BuildingType, 'footprint' | 'tribeVariants'>,
  records: readonly RecordFootprint[] | undefined,
): BuildingRecordFootprint[] {
  return (records ?? [])
    .filter((r) => {
      const standard = buildingFootprintFor(type, r.tribe);
      return standard === undefined || !sameFootprintCells(standard, r.footprint);
    })
    .map((r) => ({
      tribe: r.tribe,
      editName: r.editName,
      footprint: r.footprint,
      mapOnly: r.mapOnly === true,
    }))
    .sort((a, b) => a.tribe - b.tribe || (a.editName < b.editName ? -1 : a.editName > b.editName ? 1 : 0));
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
    const records = recordFootprints(
      { ...(footprint ? { footprint } : {}), tribeVariants: variants },
      overlays.recordFootprints.get(b.typeId),
    );
    return {
      ...b,
      ...(cost ? { construction: cost } : {}),
      ...(hp !== undefined ? { hitpoints: hp } : {}),
      ...(upgradeTarget !== undefined ? { upgradeTarget } : {}),
      ...(footprint ? { footprint } : {}),
      ...(variants.length > 0 ? { tribeVariants: variants } : {}),
      ...(records.length > 0 ? { recordFootprints: records } : {}),
    };
  });
}

/** Joins the base table's own house records behind the ones each type already has, per
 *  `(typeId, tribe, EditName)`. The game's house table leaves them out, so each joins as map-only. */
export function fillBaseRecordFootprints(
  into: Map<number, RecordFootprint[]>,
  baseRows: ReadonlyMap<number, readonly RecordFootprint[]>,
): void {
  for (const [typeId, records] of baseRows) {
    const merged = [...(into.get(typeId) ?? [])];
    for (const record of records) {
      if (!merged.some((r) => r.tribe === record.tribe && r.editName === record.editName))
        merged.push({ ...record, mapOnly: true });
    }
    into.set(typeId, merged);
  }
}
