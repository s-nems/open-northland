import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FOG_MODE, type Simulation } from '@open-northland/sim';
import { buildCollisionTerrain } from '../src/content/collision.js';
import { buildingFootprints, type ContentIr } from '../src/content/ir.js';
import { mapResourceObjectNames, spawnMapBerryBushes, spawnMapResources } from '../src/game/sandbox/index.js';
import type { AuthoredJoinRows } from '../src/slice/authored-placements.js';
import { runAuthoredSlice } from '../src/slice/vertical-slice.js';
import { contentDir, loadContentUnderTest, rawIrUnderTest } from '../test/content/helpers.js';

/**
 * The soak's world builder: the headless twin of the browser session
 * `?map=<id>&player=overseer&ai=0,1,2,3,4,5&fog=reveal`. It runs the SAME chain
 * `entries/map.ts` assembles (real merged content → collision terrain → {@link runAuthoredSlice} →
 * fog → AI seats → map resources), so a stall the soak finds is a stall a player would watch happen.
 * Only the render half is skipped, and `?speed=` with it — speed is a wall-clock multiplier on the
 * RAF loop, not a sim input.
 */

/** The seed the browser's vertical slice runs on (`SLICE_SEED` in `entries/map.ts`). */
const SLICE_SEED = 7;
/** Authored placements are enqueued pre-tick-0; the slice runs one tick so they drain. */
const PLACEMENT_DRAIN_TICKS = 1;

export interface SoakWorldOptions {
  /** Decoded map id under `content/maps/<id>.json`. */
  readonly mapId: string;
  /** Seats to flag as AI players. */
  readonly aiSeats: readonly number[];
}

export function soakMapPath(mapId: string): string {
  return resolve(contentDir(), `maps/${mapId}.json`);
}

/** Build the soak world. Throws when the map or the AI seats resolve to nothing — a soak that
 *  silently ran an empty world would report a clean bill of health it never earned. */
export async function soakWorld(options: SoakWorldOptions): Promise<Simulation> {
  const { merge } = await loadContentUnderTest();
  const map = JSON.parse(readFileSync(soakMapPath(options.mapId), 'utf8'));
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
  sim.enqueue({ kind: 'setFogMode', mode: FOG_MODE.REVEAL });
  for (const seat of options.aiSeats) sim.enqueue({ kind: 'setPlayerAi', player: seat, enabled: true });
  // The map's own trees/stone/clay and berry bushes — the `?map=` entry spawns both.
  spawnMapResources(sim, map.objects, ir);
  spawnMapBerryBushes(sim, map.objects, ir);
  return sim;
}
