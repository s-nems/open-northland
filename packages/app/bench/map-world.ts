import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  exportSaveGame,
  FOG_MODE,
  parseSaveGame,
  type SaveGame,
  type Simulation,
  serializeSaveGame,
} from '@open-northland/sim';
import { loadContentUnderTest } from '../test/content/helpers.js';
import { realMapWorld, restoreRealMapWorld } from '../test/content/real-map-world.js';
import { boolEnv, intEnv, stringEnv } from './knobs.js';

/**
 * The real-map world both map benchmarks measure, with the checkpoint that skips the build-out.
 * Hunting a late-game hotspot otherwise costs an hour of settlement growth per attempt: the first run
 * writes the state after `skipTicks` to `checkpointPath`, every later run restores it and measures
 * from there. A restored run is still the same world - the checkpoint is a normal save, taken and
 * reloaded through the `?map=` entry's own build and restore.
 *
 * A checkpoint taken on another map, another seat count or other content is refused by name rather
 * than measured: the numbers would describe a world nobody asked for.
 */

/** The session the real-map benchmarks profile: fog revealed, no progression or needs overrides. */
const BENCH_RULES = { fog: FOG_MODE.CLASSIC, progression: null, needs: null } as const;

const DEFAULT_MAP_ID = 'magiczny_las';
/** Every seat under AI, matching the `?ai=0,1,2,3,4,5` session the real-content scenarios also use. */
const DEFAULT_AI_SEATS = 6;
/** The opening ticks are atypical (crews bind, routes are cold) and JIT tiering has not settled - a
 *  restored checkpoint needs them too, since the restored world's code is cold again. */
const DEFAULT_WARMUP_TICKS = 200;

export interface MapBenchWorldOptions {
  readonly mapId: string;
  readonly aiSeats: number;
  /** Fold the per-tick sync digest, the lockstep session's cost. */
  readonly syncDigest: boolean;
  /** Where the pre-measurement state lives, or null to always build the world. */
  readonly checkpointPath: string | null;
  /** Ticks run unmeasured before the checkpoint is written; ignored on a restore. */
  readonly skipTicks: number;
}

export interface MapBenchWorld {
  readonly sim: Simulation;
  /** The map's size in visual CELLS, as the report records it. */
  readonly mapCells: { readonly width: number; readonly height: number };
  readonly source: 'built' | 'checkpoint';
  /** The tick the world stands at before warm-up, so the caller can name what it skipped. */
  readonly startTick: number;
}

/** What the header alone cannot answer: the seat count the run was built with, and the map size a
 *  restore would otherwise have to re-read the decoded map for. */
interface CheckpointStamp {
  readonly aiSeats: number;
  readonly mapCells: { readonly width: number; readonly height: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stampOf(session: unknown, path: string): CheckpointStamp {
  const seats = isRecord(session) ? session.aiSeats : undefined;
  const cells = isRecord(session) ? session.mapCells : undefined;
  if (
    typeof seats !== 'number' ||
    !isRecord(cells) ||
    typeof cells.width !== 'number' ||
    typeof cells.height !== 'number'
  ) {
    throw new Error(`${path} carries no benchmark stamp; it was not written by a benchmark run`);
  }
  return { aiSeats: seats, mapCells: { width: cells.width, height: cells.height } };
}

function readCheckpoint(path: string): SaveGame {
  try {
    return parseSaveGame(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    throw new Error(`${path} is not a readable checkpoint: ${String(err)}`);
  }
}

/** Every mismatch the numbers would silently absorb. `irVersion` covers regenerated content: the
 *  restore would reject it too, but only after the caller waited for the map to load. */
async function checkedStamp(
  save: SaveGame,
  path: string,
  options: MapBenchWorldOptions,
): Promise<CheckpointStamp> {
  const stamp = stampOf(save.header.session, path);
  const { merge } = await loadContentUnderTest();
  const irVersion = merge.content.manifest.version;
  const mismatch =
    save.header.mapId !== options.mapId
      ? `map '${save.header.mapId}', not '${options.mapId}'`
      : stamp.aiSeats !== options.aiSeats
        ? `${stamp.aiSeats} AI seat(s), not ${options.aiSeats}`
        : save.header.irVersion !== irVersion
          ? `content IR v${save.header.irVersion}, not v${irVersion}`
          : null;
  if (mismatch !== null) {
    throw new Error(`${path} holds ${mismatch}; delete it or point ON_BENCH_CHECKPOINT elsewhere`);
  }
  return stamp;
}

function writeCheckpoint(
  sim: Simulation,
  path: string,
  options: MapBenchWorldOptions,
  stamp: CheckpointStamp,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const save = exportSaveGame(sim, { mapId: options.mapId, session: stamp });
  writeFileSync(path, serializeSaveGame(save));
}

export async function mapBenchWorld(options: MapBenchWorldOptions): Promise<MapBenchWorld> {
  const path = options.checkpointPath;
  if (path !== null && existsSync(path)) {
    const save = readCheckpoint(path);
    const stamp = await checkedStamp(save, path, options);
    const sim = await restoreRealMapWorld(options.mapId, save);
    sim.setSyncDigest(options.syncDigest);
    return { sim, mapCells: stamp.mapCells, source: 'checkpoint', startTick: sim.tick };
  }

  const { sim, mapCells } = await realMapWorld({
    mapId: options.mapId,
    aiSeats: [...Array(options.aiSeats).keys()],
    rules: BENCH_RULES,
    berryBushes: true,
  });
  sim.setSyncDigest(options.syncDigest);
  sim.run(options.skipTicks);
  if (path !== null) writeCheckpoint(sim, path, options, { aiSeats: options.aiSeats, mapCells });
  return { sim, mapCells, source: 'built', startTick: sim.tick };
}

export interface MapBenchKnobs extends MapBenchWorldOptions {
  readonly warmupTicks: number;
  readonly measuredTicks: number;
}

/** The env knobs both real-map benchmarks share; `measuredTicks` differs per benchmark, so its
 *  default is the caller's. */
export function mapBenchKnobs(defaultMeasuredTicks: number): MapBenchKnobs {
  const checkpoint = stringEnv('ON_BENCH_CHECKPOINT', '');
  return {
    mapId: stringEnv('ON_BENCH_MAP', DEFAULT_MAP_ID),
    aiSeats: intEnv('ON_BENCH_SEATS', DEFAULT_AI_SEATS, 0),
    warmupTicks: intEnv('ON_BENCH_WARMUP', DEFAULT_WARMUP_TICKS, 0),
    measuredTicks: intEnv('ON_BENCH_TICKS', defaultMeasuredTicks, 1),
    syncDigest: boolEnv('ON_BENCH_SYNC_DIGEST'),
    checkpointPath: checkpoint === '' ? null : checkpoint,
    skipTicks: intEnv('ON_BENCH_SKIP', 0, 0),
  };
}

/** The shared knobs as the report records them, so a stale report cannot be read as another run. */
export function knobRecord(knobs: MapBenchKnobs): Readonly<Record<string, string>> {
  return {
    ON_BENCH_MAP: knobs.mapId,
    ON_BENCH_SEATS: `${knobs.aiSeats}`,
    ON_BENCH_TICKS: `${knobs.measuredTicks}`,
    ON_BENCH_WARMUP: `${knobs.warmupTicks}`,
    ON_BENCH_SYNC_DIGEST: knobs.syncDigest ? 'on' : 'off',
    ON_BENCH_SKIP: `${knobs.skipTicks}`,
    ON_BENCH_CHECKPOINT: knobs.checkpointPath ?? '',
  };
}

/** The line a benchmark prints so its report cannot be read as a run that started somewhere else. */
export function worldSourceLine(world: MapBenchWorld, checkpointPath: string | null): string {
  const where = checkpointPath === null ? '' : ` ${checkpointPath}`;
  if (world.source === 'checkpoint') {
    return `world: restored from checkpoint${where}, measuring from tick ${world.startTick}`;
  }
  const written = checkpointPath === null ? '' : `, checkpoint written to${where}`;
  return `world: built and stepped to tick ${world.startTick} unmeasured${written}`;
}
