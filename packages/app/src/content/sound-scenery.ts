import type { SceneryObject } from '@open-northland/audio';
import type { TerrainObjects } from '@open-northland/data';
import type { ContentIr } from './ir/rows.js';
import { PLACEMENT_STRIDE } from './map-placements.js';

/**
 * The decoded map's placed objects the sim holds no entity for (rocks, sirens, an ice wall), by their
 * `[GfxLandscape]` record, for the object ambience; the sim's resource nodes sound off the snapshot.
 * Lazy, since a large map places a hundred thousand objects and the consumer keeps only the few with a
 * sound. Approximation: the list is the map as authored, so scenery a building or a script later clears
 * keeps its sound.
 */
export function* soundScenery(
  objects: TerrainObjects,
  ir: Pick<ContentIr, 'landscapeGfx'>,
  simHeld: Iterable<number>,
): Generator<SceneryObject> {
  const recordByName = new Map<string, number>();
  for (const r of ir.landscapeGfx ?? []) {
    if (r.editName !== undefined && !recordByName.has(r.editName)) recordByName.set(r.editName, r.index);
  }
  const held = new Set(simHeld);
  const recordByType = objects.types.map((name) => recordByName.get(name));
  const { placements } = objects;
  for (
    let at = 0, ordinal = 0;
    at + PLACEMENT_STRIDE <= placements.length;
    at += PLACEMENT_STRIDE, ordinal++
  ) {
    if (held.has(ordinal)) continue;
    const hx = placements[at];
    const hy = placements[at + 1];
    const typeIndex = placements[at + 2];
    const record = typeIndex === undefined ? undefined : recordByType[typeIndex];
    if (hx !== undefined && hy !== undefined && record !== undefined) yield { id: ordinal, record, hx, hy };
  }
}
