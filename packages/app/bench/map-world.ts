import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mapLobbySlots } from '@open-northland/data';
import { aiSeatsOf, type GameSession, OBSERVER_SEAT } from '@open-northland/lockstep';
import {
  components,
  exportSaveGame,
  parseSaveGame,
  type SaveGame,
  type Simulation,
  serializeSaveGame,
} from '@open-northland/sim';
import type { FogModeName } from '../src/game/fog.js';
import { mapSession } from '../src/game/session-url.js';
import { loadContentUnderTest } from '../test/content/helpers.js';
import { realMapScript, realMapWorld, restoreRealMapWorld } from '../test/content/real-map-world.js';
import { boolEnv, intEnv, intListEnv, ruleEnv, stringEnv } from './knobs.js';
import { formatSeats } from './report/index.js';

/**
 * The real-map world both map benchmarks measure, with the checkpoints that skip the build-out.
 * Hunting a late-game hotspot otherwise costs an hour of settlement growth per attempt: a run writes
 * the state after `skipTicks` to `checkpointPath` and at every tick in `checkpointMarks`, and a later
 * run restores one of those files and measures from there. A restored run is still the same world -
 * the checkpoint is a normal save, taken and reloaded through the `?map=` entry's own build and
 * restore, and the restore must reproduce the state hash the checkpoint was written with.
 *
 * The session is the one a browser `?map=<id>&player=observer&ai=<seats>&fog=classic` search
 * describes, parsed by the entry's own URL adapter. The observer plays no seat, so the only assistant
 * grants are the AI seats' own: `player=overseer` builds the same world whenever seat 0 is an AI seat,
 * and grants seat 0's assistant as well when it is not. A checkpoint taken under another map, other AI
 * seats, other rules or other content is refused by name rather than measured: the numbers would
 * describe a world nobody asked for.
 */

/** Fog revealed as the original starts it: black, explored ground stays visible. */
const BENCH_FOG: FogModeName = 'classic';

const DEFAULT_MAP_ID = 'magiczny_las';
/** `?ai=0,1,2,3,4,5`: every seat the default map offers a person, the session the real-content
 *  scenarios also use. */
const DEFAULT_AI_SEATS = 6;
/** The opening ticks are atypical (crews bind, routes are cold) and JIT tiering has not settled - a
 *  restored checkpoint needs them too, since the restored world's code is cold again. */
const DEFAULT_WARMUP_TICKS = 200;

const CHECKPOINT_EXT = '.checkpoint';
/** The `.t<tick>` a mark adds to the checkpoint stem, stripped again when a mark file is the base. */
const MARK_SUFFIX = /\.t\d+$/;

const { isValidPlayer } = components;

export interface MapBenchWorldOptions {
  readonly mapId: string;
  /** The seats `?ai=` names, ascending. The map's own computer seats join them, as in the browser. */
  readonly seats: readonly number[];
  /** `?progression=` / `?needs=`; null keeps the map's own rule. */
  readonly progression: boolean | null;
  readonly needs: boolean | null;
  /** Fold the per-tick sync digest, the lockstep session's cost. */
  readonly syncDigest: boolean;
  /** Where the pre-measurement state lives, or null to always build the world. Also the stem the
   *  mark checkpoints are named from. */
  readonly checkpointPath: string | null;
  /** Ticks run unmeasured before the checkpoint is written; ignored on a restore. */
  readonly skipTicks: number;
  /** Absolute sim ticks, ascending, at which a checkpoint is written to {@link markCheckpointPath}. */
  readonly checkpointMarks: readonly number[];
}

export interface MapBenchWorld {
  readonly sim: Simulation;
  /** The map's size in visual CELLS, as the report records it. */
  readonly mapCells: { readonly width: number; readonly height: number };
  /** Every seat the session runs under AI, ascending. */
  readonly aiSeats: readonly number[];
  readonly source: 'built' | 'checkpoint';
  /** The tick the world stands at before warm-up, so the caller can name what it skipped. */
  readonly startTick: number;
  /** Call after every step the caller takes; writes the checkpoint of a mark the sim just reached. */
  readonly afterStep: () => void;
}

/** What the header alone cannot answer: the session the world was built with, the map size a restore
 *  would otherwise have to re-read the decoded map for, and the state hash a restore must reproduce. */
interface CheckpointStamp {
  readonly aiSeats: readonly number[];
  readonly progression: boolean | null;
  readonly needs: boolean | null;
  readonly mapCells: { readonly width: number; readonly height: number };
  readonly stateHash: string;
}

/** What a restore must match: the session, as opposed to the map size and state it carries. */
type SessionKey = Pick<CheckpointStamp, 'aiSeats' | 'progression' | 'needs'>;
type SessionStamp = Omit<CheckpointStamp, 'stateHash'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRule(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function stampOf(session: unknown, path: string): CheckpointStamp {
  const fields = isRecord(session) ? session : {};
  const { aiSeats, progression, needs, mapCells, stateHash } = fields;
  if (
    !Array.isArray(aiSeats) ||
    !aiSeats.every((seat) => typeof seat === 'number') ||
    !isRule(progression) ||
    !isRule(needs) ||
    !isRecord(mapCells) ||
    typeof mapCells.width !== 'number' ||
    typeof mapCells.height !== 'number' ||
    typeof stateHash !== 'string'
  ) {
    throw new Error(`${path} carries no benchmark stamp this tool reads; take the checkpoint again`);
  }
  return {
    aiSeats,
    progression,
    needs,
    mapCells: { width: mapCells.width, height: mapCells.height },
    stateHash,
  };
}

function readCheckpoint(path: string): SaveGame {
  try {
    return parseSaveGame(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    throw new Error(`${path} is not a readable checkpoint: ${String(err)}`);
  }
}

function ruleText(value: boolean | null): string {
  return value === null ? 'the map default' : value ? 'on' : 'off';
}

/** The `?map=` search the benchmark session is, with `?player=observer` watching every seat. */
export function benchSearch(options: MapBenchWorldOptions): URLSearchParams {
  const params = new URLSearchParams({ map: options.mapId, player: OBSERVER_SEAT });
  if (options.seats.length > 0) params.set('ai', options.seats.join(','));
  params.set('fog', BENCH_FOG);
  if (options.progression !== null) params.set('progression', options.progression ? 'on' : 'off');
  if (options.needs !== null) params.set('needs', options.needs ? 'on' : 'off');
  return params;
}

/** The session the browser would boot for {@link benchSearch}, against the map's own roster. */
export function benchSession(options: MapBenchWorldOptions): GameSession {
  const script = realMapScript(options.mapId);
  return mapSession(benchSearch(options), script === null ? [] : mapLobbySlots(script));
}

function ascending(seats: readonly number[]): readonly number[] {
  return [...seats].sort((a, b) => a - b);
}

/** Every mismatch the numbers would silently absorb. `irVersion` covers regenerated content: the
 *  restore would reject it too, but only after the caller waited for the map to load. */
async function checkedStamp(
  save: SaveGame,
  path: string,
  options: MapBenchWorldOptions,
  expected: SessionKey,
): Promise<CheckpointStamp> {
  const stamp = stampOf(save.header.session, path);
  const { merge } = await loadContentUnderTest();
  const irVersion = merge.content.manifest.version;
  const mismatch =
    save.header.mapId !== options.mapId
      ? `map '${save.header.mapId}', not '${options.mapId}'`
      : formatSeats(stamp.aiSeats) !== formatSeats(expected.aiSeats)
        ? `AI seats ${formatSeats(stamp.aiSeats)}, not ${formatSeats(expected.aiSeats)}`
        : stamp.progression !== expected.progression
          ? `progression ${ruleText(stamp.progression)}, not ${ruleText(expected.progression)}`
          : stamp.needs !== expected.needs
            ? `needs ${ruleText(stamp.needs)}, not ${ruleText(expected.needs)}`
            : save.header.irVersion !== irVersion
              ? `content IR v${save.header.irVersion}, not v${irVersion}`
              : null;
  if (mismatch !== null) {
    throw new Error(`${path} holds ${mismatch}; delete it or point ON_BENCH_CHECKPOINT elsewhere`);
  }
  return stamp;
}

function writeCheckpoint(sim: Simulation, path: string, mapId: string, session: SessionStamp): void {
  mkdirSync(dirname(path), { recursive: true });
  const stamp: CheckpointStamp = { ...session, stateHash: sim.hashState() };
  const save = exportSaveGame(sim, { mapId, session: stamp });
  writeFileSync(path, serializeSaveGame(save));
}

/** The file a mark writes: `<stem>.t<tick>.checkpoint`, where the stem is the base path without its
 *  `.checkpoint` extension or an earlier mark's `.t<tick>`, so restoring a mark and marking further
 *  keeps one family of names. */
export function markCheckpointPath(base: string, tick: number): string {
  const bare = base.endsWith(CHECKPOINT_EXT) ? base.slice(0, -CHECKPOINT_EXT.length) : base;
  return `${bare.replace(MARK_SUFFIX, '')}.t${tick}${CHECKPOINT_EXT}`;
}

/** Refuses a mark the run cannot reach before any tick is spent: a long run that finishes without
 *  the checkpoint it was started for has wasted its hour. */
function checkMarksReachable(options: MapBenchWorldOptions, fromTick: number, lastTick: number): void {
  if (options.checkpointMarks.length > 0 && options.checkpointPath === null) {
    throw new Error('ON_BENCH_CHECKPOINTS needs ON_BENCH_CHECKPOINT, the path its files are named from');
  }
  const outside = options.checkpointMarks.filter((mark) => mark <= fromTick || mark > lastTick);
  if (outside.length > 0) {
    throw new Error(
      `checkpoint mark(s) ${outside.join(', ')} fall outside this run's ticks ${fromTick + 1}..${lastTick}`,
    );
  }
}

/** The step hook that writes a mark's checkpoint on the tick the sim reaches it. */
function markWriter(sim: Simulation, options: MapBenchWorldOptions, session: SessionStamp): () => void {
  const base = options.checkpointPath;
  let next = 0;
  return () => {
    const mark = options.checkpointMarks[next];
    if (base === null || mark === undefined || sim.tick !== mark) return;
    next++;
    const path = markCheckpointPath(base, mark);
    const startMs = performance.now();
    writeCheckpoint(sim, path, options.mapId, session);
    console.log(
      `checkpoint at tick ${mark} written to ${path} (${(performance.now() - startMs).toFixed(0)} ms)`,
    );
  };
}

/**
 * Build or restore the world and run its unmeasured skip. `followingTicks` is how many steps the
 * caller takes afterwards, so a checkpoint mark past the end of the run is refused up front.
 */
export async function mapBenchWorld(
  options: MapBenchWorldOptions,
  followingTicks: number,
): Promise<MapBenchWorld> {
  const session = benchSession(options);
  const sessionAiSeats = aiSeatsOf(session);
  const expected: SessionKey = {
    aiSeats: ascending(sessionAiSeats),
    progression: session.rules.progression,
    needs: session.rules.needs,
  };

  const path = options.checkpointPath;
  if (path !== null && existsSync(path)) {
    const save = readCheckpoint(path);
    const stamp = await checkedStamp(save, path, options, expected);
    const sim = await restoreRealMapWorld(options.mapId, save);
    const restoredHash = sim.hashState();
    if (restoredHash !== stamp.stateHash) {
      throw new Error(
        `${path} restores to state ${restoredHash}, not the ${stamp.stateHash} it was written at; ` +
          'the save round trip lost state, so a measurement from it would not describe the run',
      );
    }
    sim.setSyncDigest(options.syncDigest);
    checkMarksReachable(options, sim.tick, sim.tick + followingTicks);
    const sessionStamp: SessionStamp = { ...expected, mapCells: stamp.mapCells };
    return {
      sim,
      mapCells: stamp.mapCells,
      aiSeats: stamp.aiSeats,
      source: 'checkpoint',
      startTick: sim.tick,
      afterStep: markWriter(sim, options, sessionStamp),
    };
  }

  const { sim, mapCells } = await realMapWorld({
    mapId: options.mapId,
    seats: session.seats,
    aiSeats: sessionAiSeats,
    rules: session.rules,
    berryBushes: true,
  });
  sim.setSyncDigest(options.syncDigest);
  checkMarksReachable(options, sim.tick, sim.tick + options.skipTicks + followingTicks);
  const sessionStamp: SessionStamp = { ...expected, mapCells };
  const afterStep = markWriter(sim, options, sessionStamp);
  for (let i = 0; i < options.skipTicks; i++) {
    sim.step();
    afterStep();
  }
  if (path !== null) writeCheckpoint(sim, path, options.mapId, sessionStamp);
  return { sim, mapCells, aiSeats: expected.aiSeats, source: 'built', startTick: sim.tick, afterStep };
}

export interface MapBenchKnobs extends MapBenchWorldOptions {
  readonly warmupTicks: number;
  readonly measuredTicks: number;
}

/** `ON_BENCH_SEATS`: a count names seats `0..n-1`, a comma list names the seats themselves. */
function seatsEnv(name: string): readonly number[] {
  const raw = stringEnv(name, '');
  const seats = raw.includes(',')
    ? intListEnv(name, 0)
    : [...Array(intEnv(name, DEFAULT_AI_SEATS, 0)).keys()];
  const invalid = seats.filter((seat) => !isValidPlayer(seat));
  if (invalid.length > 0)
    throw new Error(`${name} names seat(s) ${invalid.join(', ')}, which are not player slots`);
  return seats;
}

/** The env knobs both real-map benchmarks share; `measuredTicks` differs per benchmark, so its
 *  default is the caller's. */
export function mapBenchKnobs(defaultMeasuredTicks: number): MapBenchKnobs {
  const checkpoint = stringEnv('ON_BENCH_CHECKPOINT', '');
  return {
    mapId: stringEnv('ON_BENCH_MAP', DEFAULT_MAP_ID),
    seats: seatsEnv('ON_BENCH_SEATS'),
    progression: ruleEnv('ON_BENCH_PROGRESSION'),
    needs: ruleEnv('ON_BENCH_NEEDS'),
    warmupTicks: intEnv('ON_BENCH_WARMUP', DEFAULT_WARMUP_TICKS, 0),
    measuredTicks: intEnv('ON_BENCH_TICKS', defaultMeasuredTicks, 1),
    syncDigest: boolEnv('ON_BENCH_SYNC_DIGEST'),
    checkpointPath: checkpoint === '' ? null : checkpoint,
    skipTicks: intEnv('ON_BENCH_SKIP', 0, 0),
    checkpointMarks: intListEnv('ON_BENCH_CHECKPOINTS', 1),
  };
}

/** The seats as `seatsEnv` reads them back: no seat is the count `0`, one seat the list `n,`. */
function seatsKnob(seats: readonly number[]): string {
  if (seats.length === 0) return '0';
  return seats.length === 1 ? `${seats[0]},` : seats.join(',');
}

function ruleKnob(value: boolean | null): string {
  return value === null ? '' : value ? 'on' : 'off';
}

/** The shared knobs as the report records them, so a stale report cannot be read as another run. */
export function knobRecord(knobs: MapBenchKnobs): Readonly<Record<string, string>> {
  return {
    ON_BENCH_MAP: knobs.mapId,
    ON_BENCH_SEATS: seatsKnob(knobs.seats),
    ON_BENCH_PROGRESSION: ruleKnob(knobs.progression),
    ON_BENCH_NEEDS: ruleKnob(knobs.needs),
    ON_BENCH_TICKS: `${knobs.measuredTicks}`,
    ON_BENCH_WARMUP: `${knobs.warmupTicks}`,
    ON_BENCH_SYNC_DIGEST: knobs.syncDigest ? 'on' : 'off',
    ON_BENCH_SKIP: `${knobs.skipTicks}`,
    ON_BENCH_CHECKPOINT: knobs.checkpointPath ?? '',
    ON_BENCH_CHECKPOINTS: knobs.checkpointMarks.join(','),
  };
}

/** The lines a benchmark prints so its report cannot be read as a run of another session or one that
 *  started somewhere else. */
export function worldSourceLines(world: MapBenchWorld, knobs: MapBenchKnobs): readonly string[] {
  const checkpointPath = knobs.checkpointPath;
  const search = decodeURIComponent(benchSearch(knobs).toString());
  const session = `session: ?${search}  (AI seats ${formatSeats(world.aiSeats)})`;
  const where = checkpointPath === null ? '' : ` ${checkpointPath}`;
  if (world.source === 'checkpoint') {
    return [session, `world: restored from checkpoint${where}, measuring from tick ${world.startTick}`];
  }
  const written = checkpointPath === null ? '' : `, checkpoint written to${where}`;
  return [session, `world: built and stepped to tick ${world.startTick} unmeasured${written}`];
}
