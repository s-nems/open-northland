import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FOG_MODE, Simulation } from '@open-northland/sim';
import { buildCollisionTerrain } from '../../src/content/collision.js';
import { buildingFootprints } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import {
  mapResourceObjectNames,
  spawnMapBerryBushes,
  spawnMapResources,
} from '../../src/game/sandbox/index.js';
import type { AuthoredJoinRows } from '../../src/slice/authored-placements.js';
import { runAuthoredSlice } from '../../src/slice/vertical-slice.js';
import { contentDir, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * The one headless build of a REAL decoded map — the same chain `entries/map.ts` assembles for
 * `?map=<id>&ai=<seats>&fog=<mode>` (real merged content → collision terrain → {@link runAuthoredSlice}
 * → fog → AI seats → map objects). Shared by the real-content scenario tests and the gatherer soak so
 * neither drifts from the browser boot the way two copies would. Only the render half is skipped, and
 * `?speed=` with it — speed multiplies the RAF loop, not the sim.
 */

/** The seed the browser's vertical slice runs on (`SLICE_SEED` in `entries/map.ts`). */
const SLICE_SEED = 7;
/** Authored placements are enqueued pre-tick-0; the slice runs one tick so they drain. */
const PLACEMENT_DRAIN_TICKS = 1;

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
  /** The raw fetched-IR document, exactly what the browser flow hands these consumers — callers assert
   *  against real ids (building typeIds, good ids) through it rather than inlining decoded numbers. */
  readonly ir: ContentIr & AuthoredJoinRows;
}

export function realMapPath(mapId: string): string {
  return resolve(contentDir(), `maps/${mapId}.json`);
}

/** Build the world. Throws when the map resolves no authored placements — a run that silently started
 *  on an empty world would report a clean bill of health it never earned. */
export async function realMapWorld(options: RealMapWorldOptions): Promise<RealMapWorld> {
  const { merge } = await loadContentUnderTest();
  const map = JSON.parse(readFileSync(realMapPath(options.mapId), 'utf8'));
  const ir = rawIrUnderTest() as ContentIr & AuthoredJoinRows;
  const simMap = buildCollisionTerrain(map, ir, mapResourceObjectNames(ir));
  const sim = runAuthoredSlice(
    SLICE_SEED,
    PLACEMENT_DRAIN_TICKS,
    simMap,
    map.entities,
    ir,
    buildingFootprints(ir),
    undefined,
    merge.content,
  );
  if (sim === null) throw new Error(`${options.mapId} resolved no authored placements`);
  if (options.fog !== undefined) sim.enqueue({ kind: 'setFogMode', mode: options.fog });
  for (const seat of options.aiSeats) sim.enqueue({ kind: 'setPlayerAi', player: seat, enabled: true });
  // The map's own trees/stone/clay as harvestable Resource nodes — the collectors flag themselves beside these.
  spawnMapResources(sim, map.objects, ir);
  if (options.berryBushes === true) spawnMapBerryBushes(sim, map.objects, ir);
  return { sim, ir };
}
