import {
  type BuildingBobRef,
  type BuildingOverlayRef,
  type BuildingSkinTables,
  type BuildingTribeTables,
  type BuildingTypeBinding,
  type ConstructionLayerRef,
  houseRecordKey,
} from '@open-northland/render';
import type { WorldTribes } from '../../game/world-tribes.js';
import type { ContentIr } from '../ir/rows.js';
import { constructionRefsByType, upgradeRefsByType } from './construction.js';
import { doorBobsByBody } from './doors.js';
import {
  type BuildingFamily,
  type BuildingRefScope,
  buildingBobRefsByType,
  buildingFamiliesFor,
  buildingLevelRefsByType,
  DEFAULT_BUILDING_FAMILY,
  HOUSE_BOB,
  perTypeHouseRows,
  skinSlotCount,
  VIKING_HOUSE01_BOBS,
  VIKING_TRIBE,
} from './families.js';
import { landscapeOverlayFamilies, landscapeOverlayRefs } from './landscape-overlays.js';
import { buildingOverlayRefsByType } from './overlays.js';
import { houseRecordDraws } from './records.js';

/** One skin slot of a tribe's building tables, from its own `[GfxHouse]` rows in the families the sheet
 *  loaded. */
function skinTables(ir: ContentIr | null, scope: BuildingRefScope): BuildingSkinTables {
  const constructionByType = constructionRefsByType(ir?.constructionLayers ?? [], scope);
  const upgradeByType = upgradeRefsByType(ir?.constructionLayers ?? [], scope);
  const overlayByType = buildingOverlayRefsByType(ir?.buildingOverlays ?? [], scope);
  const byType: Record<number, BuildingBobRef> = {
    // The transcribed constant backs the base tribe when the IR is absent; the extracted rows overlay it
    // per type.
    ...(scope.tribeId === VIKING_TRIBE ? VIKING_HOUSE01_BOBS : {}),
    ...buildingBobRefsByType(ir?.buildingBobs ?? [], scope),
  };
  const byTypeLevel = buildingLevelRefsByType(ir?.buildingBobs ?? [], scope);
  return {
    byType,
    ...(Object.keys(byTypeLevel).length > 0 ? { byTypeLevel } : {}),
    landscapeOverlaysByType: landscapeOverlayRefs(ir, scope.tribeId),
    ...(Object.keys(constructionByType).length > 0 ? { constructionByType } : {}),
    ...(Object.keys(upgradeByType).length > 0 ? { upgradeByType } : {}),
    ...(Object.keys(overlayByType).length > 0 ? { overlayByType } : {}),
  };
}

/** Every skin slot of one tribe's building tables, slot 0 carrying the rest as `altSkins`. */
function tribeTables(
  ir: ContentIr | null,
  tribeId: number,
  families: readonly BuildingFamily[],
): BuildingTribeTables {
  const slots = skinSlotCount(
    [ir?.buildingBobs ?? [], ir?.constructionLayers ?? [], ir?.buildingOverlays ?? []],
    tribeId,
  );
  const skins = Array.from({ length: slots }, (_, skinSlot) =>
    skinTables(ir, { tribeId, skinSlot, defaultFamily: DEFAULT_BUILDING_FAMILY, families }),
  );
  const [first, ...altSkins] = skins;
  if (first === undefined) throw new Error('building skins: a tribe has at least one skin slot');
  return altSkins.length > 0 ? { ...first, altSkins } : first;
}

/**
 * The render's building binding for every tribe in `tribes`, the first of which is the base whose tables
 * serve a building of an unloaded tribe. A typeId a tribe does not skin falls back to the base tribe's
 * bob rather than the generic default house, since the tribes share the `typeId` space.
 */
export function buildingBinding(
  ir: ContentIr | null,
  tribes: WorldTribes,
  families: readonly BuildingFamily[],
): BuildingTypeBinding {
  const perType = perTypeHouseRows(ir);
  const base = tribeTables(perType, tribes[0], families);
  const byTribe: Record<number, BuildingTribeTables> = { [tribes[0]]: base };
  for (const tribe of tribes) byTribe[tribe] ??= tribeTables(perType, tribe, families);
  const byRecord = houseRecordDraws(perType, tribes, families);
  const upgradeTargetByType: Record<number, number> = {};
  for (const b of ir?.buildings ?? []) {
    if (b.typeId !== undefined && b.upgradeTarget !== undefined)
      upgradeTargetByType[b.typeId] = b.upgradeTarget;
  }
  const doorByBody = doorBobsByBody(perType?.buildingBobs ?? [], perType?.buildingDoors ?? [], families);
  return {
    ...base,
    default: HOUSE_BOB,
    byTribe,
    ...(byRecord.size > 0 ? { byRecord } : {}),
    ...(Object.keys(doorByBody).length > 0 ? { doorByBody } : {}),
    ...(Object.keys(upgradeTargetByType).length > 0 ? { upgradeTargetByType } : {}),
  };
}

/** The bob a type is bound to for its own tribe, as the house `record` where the binding draws it, then
 *  for the sheet's base tribe; `undefined` when no civilization skins it (the wonders and `work_murek`),
 *  where the total `resolveBuildingDraw` would hand back the default house. */
export function boundBuildingRef(
  binding: number | BuildingTypeBinding,
  typeId: number,
  tribe: number | undefined,
  record?: string,
): BuildingBobRef | undefined {
  if (typeof binding === 'number') return binding;
  if (record !== undefined && tribe !== undefined) {
    const own = binding.byRecord?.get(houseRecordKey(tribe, typeId, record));
    if (own !== undefined) return own.body;
  }
  const own = tribe !== undefined ? binding.byTribe?.[tribe] : undefined;
  return own?.byType[typeId] ?? binding.byType[typeId];
}

/** Every named family atlas a binding draws from, so the sheet loads exactly those pages. */
export function referencedFamilyLayers(binding: BuildingTypeBinding): Set<string> {
  const layers = new Set<string>();
  const tribes = [binding, ...Object.values(binding.byTribe ?? {})];
  for (const tables of tribes.flatMap((tribe) => [tribe, ...(tribe.altSkins ?? [])])) {
    const levelRefs = Object.values(tables.byTypeLevel ?? {}).flatMap((byLevel) => Object.values(byLevel));
    for (const ref of [...Object.values<BuildingBobRef>(tables.byType), ...levelRefs]) {
      if (typeof ref !== 'number') layers.add(ref.layer);
    }
    for (const stack of [
      ...Object.values<readonly ConstructionLayerRef[]>(tables.constructionByType ?? {}),
      ...Object.values<readonly ConstructionLayerRef[]>(tables.upgradeByType ?? {}),
    ]) {
      for (const stage of stack) if (stage.layer !== undefined) layers.add(stage.layer);
    }
    for (const byLevel of Object.values(tables.landscapeOverlaysByType ?? {})) {
      for (const overlay of Object.values(byLevel).flat()) layers.add(overlay.layer);
    }
    for (const overlay of Object.values<BuildingOverlayRef>(tables.overlayByType ?? {})) {
      if (overlay.layer !== undefined) layers.add(overlay.layer);
    }
  }
  for (const record of binding.byRecord?.values() ?? []) {
    if (typeof record.body !== 'number') layers.add(record.body.layer);
    for (const overlay of record.landscapeOverlays ?? []) layers.add(overlay.layer);
  }
  return layers;
}

/** The families the loader must fetch for `tribes`: every one their rows reference, so the two-pass
 *  reduction can narrow them to the ones the winning rows actually draw from. */
export function candidateFamilies(ir: ContentIr | null, tribes: WorldTribes): BuildingFamily[] {
  return buildingFamiliesFor(
    [
      ...(ir?.buildingBobs ?? []),
      ...(ir?.constructionLayers ?? []),
      ...(ir?.buildingOverlays ?? []),
      ...landscapeOverlayFamilies(ir),
    ],
    tribes,
    DEFAULT_BUILDING_FAMILY,
  );
}
