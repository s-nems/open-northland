import type {
  BuildingBobRef,
  BuildingOverlayRef,
  BuildingTribeTables,
  BuildingTypeBinding,
  ConstructionLayerRef,
} from '@open-northland/render';
import type { WorldTribes } from '../../game/world-tribes.js';
import type { ContentIr } from '../ir/rows.js';
import { constructionRefsByType, upgradeRefsByType } from './construction.js';
import {
  type BuildingFamily,
  type BuildingRefScope,
  buildingBobRefsByType,
  buildingFamiliesFor,
  DEFAULT_BUILDING_FAMILY,
  HOUSE_BOB,
  preferredPaletteFor,
  VIKING_HOUSE01_BOBS,
  VIKING_TRIBE,
} from './families.js';
import { buildingOverlayRefsByType } from './overlays.js';

/** One tribe's building tables, from its own `[GfxHouse]` rows in the families the sheet loaded. */
function tribeTables(ir: ContentIr | null, scope: BuildingRefScope): BuildingTribeTables {
  const constructionByType = constructionRefsByType(ir?.constructionLayers ?? [], scope);
  const upgradeByType = upgradeRefsByType(ir?.constructionLayers ?? [], scope);
  const overlayByType = buildingOverlayRefsByType(ir?.buildingOverlays ?? [], scope);
  const byType: Record<number, BuildingBobRef> = {
    // The transcribed constant backs the base tribe for an IR that is absent or predates the lane; the
    // extracted rows overlay it per type.
    ...(scope.tribeId === VIKING_TRIBE ? VIKING_HOUSE01_BOBS : {}),
    ...buildingBobRefsByType(ir?.buildingBobs ?? [], scope),
  };
  return {
    byType,
    ...(Object.keys(constructionByType).length > 0 ? { constructionByType } : {}),
    ...(Object.keys(upgradeByType).length > 0 ? { upgradeByType } : {}),
    ...(Object.keys(overlayByType).length > 0 ? { overlayByType } : {}),
  };
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
  const scopeFor = (tribeId: number): BuildingRefScope => ({
    tribeId,
    preferredPalette: preferredPaletteFor(ir?.buildingBobs ?? [], tribeId),
    defaultFamily: DEFAULT_BUILDING_FAMILY,
    families,
  });
  const base = tribeTables(ir, scopeFor(tribes[0]));
  const byTribe: Record<number, BuildingTribeTables> = { [tribes[0]]: base };
  for (const tribe of tribes) byTribe[tribe] ??= tribeTables(ir, scopeFor(tribe));
  return { ...base, default: HOUSE_BOB, byTribe };
}

/** Every named family atlas a binding draws from, so the sheet loads exactly those pages. */
export function referencedFamilyLayers(binding: BuildingTypeBinding): Set<string> {
  const layers = new Set<string>();
  for (const tables of [binding, ...Object.values(binding.byTribe ?? {})]) {
    for (const ref of Object.values<BuildingBobRef>(tables.byType)) {
      if (typeof ref !== 'number') layers.add(ref.layer);
    }
    for (const stack of [
      ...Object.values<readonly ConstructionLayerRef[]>(tables.constructionByType ?? {}),
      ...Object.values<readonly ConstructionLayerRef[]>(tables.upgradeByType ?? {}),
    ]) {
      for (const stage of stack) if (stage.layer !== undefined) layers.add(stage.layer);
    }
    for (const overlay of Object.values<BuildingOverlayRef>(tables.overlayByType ?? {})) {
      if (overlay.layer !== undefined) layers.add(overlay.layer);
    }
  }
  return layers;
}

/** The families the loader must fetch for `tribes`: every one their rows reference, so the two-pass
 *  reduction can narrow them to the ones the winning rows actually draw from. */
export function candidateFamilies(ir: ContentIr | null, tribes: WorldTribes): BuildingFamily[] {
  return buildingFamiliesFor(
    [...(ir?.buildingBobs ?? []), ...(ir?.constructionLayers ?? []), ...(ir?.buildingOverlays ?? [])],
    tribes,
    DEFAULT_BUILDING_FAMILY,
  );
}
