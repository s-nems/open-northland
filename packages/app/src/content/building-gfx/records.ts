import { type AuthoredBuildingDraw, houseRecordKey } from '@open-northland/render';
import type { WorldTribes } from '../../game/world-tribes.js';
import type { ContentIr } from '../ir/rows.js';
import {
  type BuildingFamily,
  canonicalBuildingRow,
  DEFAULT_BUILDING_FAMILY,
  familyLayerFor,
} from './families.js';
import { landscapeOverlayRefs } from './landscape-overlays.js';

/**
 * How each house record a building may stand as draws, keyed by {@link houseRecordKey}: the records a
 * type stands on a footprint of its own for a tribe in `tribes`, the only ones the sim keeps on a
 * building. Each takes its first skin's body, its landscape overlay slots and its flag point, as an
 * authored map house of that record does. A record whose family is not loaded is left out and draws its
 * type's default house.
 */
export function houseRecordDraws(
  ir: ContentIr | null,
  tribes: WorldTribes,
  families: readonly BuildingFamily[],
): ReadonlyMap<string, AuthoredBuildingDraw> {
  const draws = new Map<string, AuthoredBuildingDraw>();
  if (ir === null) return draws;
  for (const building of ir.buildings ?? []) {
    const typeId = building.typeId;
    if (typeId === undefined) continue;
    for (const { tribe, editName } of building.recordFootprints ?? []) {
      if (!tribes.includes(tribe)) continue;
      const rows = (ir.buildingBobs ?? []).filter((row) => row.editName === editName);
      const row = canonicalBuildingRow(rows, tribe, typeId);
      if (row === undefined) continue;
      const layer = familyLayerFor(row.bmd, row.paletteName, DEFAULT_BUILDING_FAMILY, families);
      if (layer === null) continue;
      const flag = (ir.buildingFlagPoints ?? []).find(
        (point) =>
          point.tribeId === tribe &&
          point.typeId === typeId &&
          point.editName === editName &&
          point.level === row.level,
      );
      draws.set(houseRecordKey(tribe, typeId, editName), {
        typeId,
        tribe,
        level: row.level,
        body: layer.layer === undefined ? row.bobId : { layer: layer.layer, bob: row.bobId },
        landscapeOverlays: landscapeOverlayRefs(ir, tribe, editName)[typeId]?.[row.level] ?? [],
        ...(flag === undefined ? {} : { flagPoint: { x: flag.x, y: flag.y } }),
      });
    }
  }
  return draws;
}
