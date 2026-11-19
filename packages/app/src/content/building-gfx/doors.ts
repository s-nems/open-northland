import { bobKey } from '@open-northland/render';
import type { BuildingBobRow, BuildingDoorRow } from '../ir/rows.js';
import { type BuildingFamily, DEFAULT_BUILDING_FAMILY, familyLayerFor } from './families.js';

const recordLevelKey = (row: BuildingBobRow | BuildingDoorRow): string =>
  `${row.tribeId}|${row.typeId}|${row.level}|${row.bmd}|${row.paletteName}|${row.editName ?? ''}`;

const artKey = (row: BuildingBobRow | BuildingDoorRow, bob: number): string =>
  `${row.bmd}|${row.paletteName}|${bob}`;

/**
 * The open-door bob of each finished body that has one, keyed by the body's {@link bobKey}: a door row
 * belongs to the body its own `[GfxHouse]` record draws at the same level and palette, so whichever body
 * a building resolves to brings its own door. A row in an unloaded family is dropped.
 *
 * The pack authors real door art for the viking houses only: most rows of the other tribes repeat a
 * viking bob id against their own `.bmd`, where the frame is missing or empty and so draws nothing.
 * Two guards keep such a row from drawing wrong art where its id does exist: a door bob that is a body
 * of the same art is no door, and a body two records claim with different doors gets none.
 */
export function doorBobsByBody(
  bodies: readonly BuildingBobRow[],
  doors: readonly BuildingDoorRow[],
  families: readonly BuildingFamily[],
): Record<string, number> {
  const bodyBobs = new Map<string, number>();
  const bodyArt = new Set<string>();
  for (const body of bodies) {
    bodyBobs.set(recordLevelKey(body), body.bobId);
    bodyArt.add(artKey(body, body.bobId));
  }
  const out: Record<string, number> = {};
  const contested = new Set<string>();
  for (const door of doors) {
    const body = bodyBobs.get(recordLevelKey(door));
    if (body === undefined || bodyArt.has(artKey(door, door.bobId))) continue;
    const layer = familyLayerFor(door.bmd, door.paletteName, DEFAULT_BUILDING_FAMILY, families);
    if (layer === null) continue;
    const key = bobKey(layer.layer === undefined ? { bob: body } : { bob: body, layer: layer.layer });
    if (out[key] !== undefined && out[key] !== door.bobId) contested.add(key);
    out[key] = door.bobId;
  }
  for (const key of contested) delete out[key];
  return out;
}
