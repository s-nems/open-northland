import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ContentSet, MapScript } from '@open-northland/data';
import type { FOG_MODE, Simulation } from '@open-northland/sim';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorld } from '../../src/entries/map/world.js';
import type { AuthoredJoinRows } from '../../src/game/world/index.js';
import { contentDir, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * The one headless build of a REAL decoded map - the `?map=<id>&ai=<seats>&fog=<mode>` world through the
 * entry's own {@link buildMapWorld}, so a scenario run and the browser boot cannot drift. Only the render
 * half is skipped, and `?speed=` with it - speed multiplies the RAF loop, not the sim.
 */

/** The seed the browser's map entry runs on (`WORLD_SEED` in `entries/map.ts`). */
const MAP_SEED = 7;

export interface RealMapWorldOptions {
  /** Decoded map id under `content/maps/<id>.json`. */
  readonly mapId: string;
  /** Seats to flag as AI players. */
  readonly aiSeats: readonly number[];
  /** Fog mode to enqueue; omitted leaves the sim's default. */
  readonly fog?: (typeof FOG_MODE)[keyof typeof FOG_MODE];
  /** Also spawn the map's berry bushes (the `?map=` entry does; a scenario that ignores food need not). */
  readonly berryBushes?: boolean;
}

export interface RealMapWorld {
  readonly sim: Simulation;
  /** The merged content the sim runs on - what a caller passes back into the sim's content read views. */
  readonly content: ContentSet;
  /** The raw fetched-IR document, exactly what the browser flow hands these consumers - callers assert
   *  against real ids (building typeIds, good ids) through it rather than inlining decoded numbers. */
  readonly ir: ContentIr & AuthoredJoinRows;
  /** The map's size in visual CELLS, not the half-cell nodes `sim.terrain` is indexed in. */
  readonly mapCells: { readonly width: number; readonly height: number };
}

export function realMapPath(mapId: string): string {
  return resolve(contentDir(), `maps/${mapId}.json`);
}

/** The map's `.script.json` sidecar, absent for a map that ships none - the browser's `loadMapScript`
 *  twin, so the headless world seeds the same diplomacy rows the entry does. */
function realMapScript(mapId: string): MapScript | null {
  const path = resolve(contentDir(), `maps/${mapId}.script.json`);
  if (!existsSync(path)) return null;
  return MapScript.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Build the world. Throws when the map is absent or resolves no authored placements - a run that
 *  silently started on an empty world would report a clean bill of health it never earned. */
export async function realMapWorld(options: RealMapWorldOptions): Promise<RealMapWorld> {
  const { merge } = await loadContentUnderTest();
  const mapPath = realMapPath(options.mapId);
  // Named explicitly: a mistyped map id otherwise surfaces as a bare ENOENT from inside vitest.
  if (!existsSync(mapPath)) throw new Error(`no decoded map at ${mapPath}`);
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const script = realMapScript(options.mapId);
  const ir = rawIrUnderTest() as ContentIr & AuthoredJoinRows;
  const world = buildMapWorld({
    seed: MAP_SEED,
    map,
    ir,
    // Only `content` matters here: the real-content override replaces the sandbox build whole, so a
    // footprint overlay would be ignored (see resolveWorldContent).
    content: { content: merge.content },
    aiSeats: options.aiSeats,
    // Each AI seat's assistant, so a headless run measures an economy that dresses itself like the
    // browser's. The entry also grants to the seat the person controls; a headless run has none.
    assistantSeats: options.aiSeats,
    diplomacy: script?.diplomacy ?? [],
    fog: options.fog ?? null,
    progression: null,
    needs: null,
    berryBushes: options.berryBushes === true,
  });
  if (world.kind !== 'authored') throw new Error(`${options.mapId} resolved no authored placements`);
  return { sim: world.sim, content: merge.content, ir, mapCells: { width: map.width, height: map.height } };
}
