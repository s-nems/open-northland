import type { AtlasFrame, ElevationField, GroundWave } from '@open-northland/render';
import { halfCellToScreen } from '@open-northland/render';
import { diag } from '../diag/index.js';
import { landscapeRecordsByName } from './ir/joins.js';
import { loadLayer, MissingAtlasError } from './ir/load.js';
import type { ContentIr, LandscapeGfxRow } from './ir/rows.js';
import { forEachPlacement } from './map-placements.js';
import { type MapObjectsData, stateIndexForLevel } from './objects.js';

/** The served `.indexed` atlas of a displacement record's bob set, where the pipeline keeps raw values. */
function effectAtlasStem(record: Pick<LandscapeGfxRow, 'bmd'>): string | undefined {
  const bmd = record.bmd;
  if (bmd === undefined || bmd.trim() === '') return undefined;
  return `${bmd.slice(bmd.lastIndexOf('/') + 1).replace(/\.bmd$/i, '')}.indexed`;
}

/** The waves plus a placement-ordinal map, the key a script's landscape removal names them by. */
export interface LoadedGroundWaves {
  readonly waves: readonly GroundWave[];
  readonly byPlacement: ReadonlyMap<number, GroundWave>;
}

/**
 * The map's `GfxUserFXMatrix` placements (the shore waves) as ground-lift effects. Their frames loop one
 * per sim tick from the original's per-node phase `x + 2y`; which lattice the original's node
 * coordinates count in is unconfirmed, so the half-cell is used.
 */
export async function loadGroundWaves(
  objects: MapObjectsData,
  ir: ContentIr,
  elevation?: ElevationField,
): Promise<LoadedGroundWaves> {
  const recordByName = landscapeRecordsByName(ir);
  const effectTypes = objects.types.map((type) => {
    const record = recordByName.get(type);
    return record?.userFxMatrix === true ? record : undefined;
  });
  const stems = new Set(effectTypes.flatMap((r) => (r === undefined ? [] : [effectAtlasStem(r)])));
  const layers = new Map<string, Awaited<ReturnType<typeof loadLayer>>>();
  await Promise.all(
    [...stems].map(async (stem) => {
      if (stem === undefined) return;
      try {
        layers.set(stem, await loadLayer(stem));
      } catch (err) {
        if (!(err instanceof MissingAtlasError)) throw err;
        diag.warn('content', `ground waves: effect atlas ${stem} missing`);
      }
    }),
  );
  // Per type, per state list: the non-empty frames of that list.
  const framesByType = effectTypes.map((record) => {
    const stem = record === undefined ? undefined : effectAtlasStem(record);
    const layer = stem === undefined ? undefined : layers.get(stem);
    if (record === undefined || layer === undefined) return undefined;
    return {
      source: layer.source,
      states: (record.frames ?? []).map((list) =>
        list.bobIds
          .map((id) => layer.atlas.frames.get(id))
          .filter((f): f is AtlasFrame => f !== undefined && f.width > 0 && f.height > 0),
      ),
    };
  });
  const waves: GroundWave[] = [];
  const byPlacement = new Map<number, GroundWave>();
  forEachPlacement(objects.placements, (hx, hy, typeIndex, placement) => {
    const type = framesByType[typeIndex];
    if (type === undefined) return;
    const level = objects.levels?.[placement] ?? type.states.length;
    const frames = type.states[stateIndexForLevel(level, type.states.length)] ?? type.states[0];
    if (frames === undefined || frames.length === 0) return;
    const screen = halfCellToScreen(hx, hy);
    const lift = elevation?.liftAtNode(hx, hy) ?? 0;
    const wave: GroundWave = {
      x: screen.x,
      y: screen.y,
      source: type.source,
      frames,
      phase: hx + 2 * hy,
      ...(lift !== 0 ? { lift } : {}),
    };
    waves.push(wave);
    byPlacement.set(placement, wave);
  });
  return { waves, byPlacement };
}
