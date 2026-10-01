import type { BuildingBobRow, ContentIr } from '../ir/rows.js';
import { canonicalBuildingRow } from './families.js';

/** The building whose sprite stands for a civilization in the menus: every civilization founds one. */
const EMBLEM_BUILDING = 'headquarters';

/** The emblem building's type in a content set's building list. */
export function emblemBuildingType(
  buildings: readonly { readonly id: string; readonly typeId: number }[],
): number | undefined {
  return buildings.find((row) => row.id === EMBLEM_BUILDING)?.typeId;
}

/** Each tribe's emblem row, its headquarters in the first listed skin; a tribe with none is absent. */
export function tribeEmblemRows(
  ir: Pick<ContentIr, 'buildings' | 'buildingBobs'>,
  tribes: readonly number[],
): ReadonlyMap<number, BuildingBobRow> {
  const typeId = ir.buildings?.find((row) => row.id === EMBLEM_BUILDING)?.typeId;
  const emblems = new Map<number, BuildingBobRow>();
  if (typeId === undefined) return emblems;
  for (const tribe of tribes) {
    const row = canonicalBuildingRow(ir.buildingBobs ?? [], tribe, typeId);
    if (row !== undefined) emblems.set(tribe, row);
  }
  return emblems;
}
