import type { BuildingLandscapeOverlayRef } from '@open-northland/render';
import { landscapeRecordsByName, servedAtlasStem } from '../ir/joins.js';
import type { ContentIr } from '../ir/rows.js';

/** Resolve source names once at boot; the renderer only reads slots and atlas frame ids. */
export function landscapeOverlayRefs(
  ir: ContentIr | null,
  tribeId: number,
  editName?: string,
): Record<number, readonly BuildingLandscapeOverlayRef[]> {
  const output: Record<number, BuildingLandscapeOverlayRef[]> = {};
  if (ir === null) return output;
  const landscapes = landscapeRecordsByName(ir);
  for (const row of ir.buildingLandscapeOverlays ?? []) {
    if (row.tribeId !== tribeId || (editName !== undefined && row.editName !== editName)) continue;
    const landscape = landscapes.get(row.landscape);
    if (landscape === undefined) continue;
    const layer = servedAtlasStem(landscape);
    const frames = landscape.frames?.[0]?.bobIds;
    if (layer === undefined || frames === undefined || frames.length === 0) continue;
    output[row.typeId] ??= [];
    const slots = output[row.typeId];
    if (slots === undefined) continue;
    if (slots.some((slot) => slot.slot === row.slot)) continue;
    slots.push({ slot: row.slot, layer, frames, x: row.x, y: row.y, animated: landscape.isStatic !== true });
  }
  for (const rows of Object.values(output)) rows.sort((a, b) => a.slot - b.slot);
  return output;
}

export function landscapeOverlayFamilies(
  ir: ContentIr | null,
): { tribeId: number; bmd: string; paletteName: string }[] {
  if (ir === null) return [];
  const landscapes = landscapeRecordsByName(ir);
  return (ir.buildingLandscapeOverlays ?? []).flatMap((overlay) => {
    const row = landscapes.get(overlay.landscape);
    return row?.bmd === undefined || row.paletteName === undefined
      ? []
      : [{ tribeId: overlay.tribeId, bmd: row.bmd, paletteName: row.paletteName }];
  });
}
