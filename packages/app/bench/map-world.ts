import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mapLobbySlots } from '@open-northland/data';
import { type GameSession, machineSeatsOf, OBSERVER_SEAT } from '@open-northland/lockstep';
import {
  components,
  exportSaveGame,
  parseSaveGame,
  type SaveGame,
  type Simulation,
  serializeSaveGame,
} from '@open-northland/sim';
import type { FogModeName } from '../src/game/fog.js';
import { mapSessionWorld, mapVariantParam, variantMapScript } from '../src/game/map/variant.js';
import { mapIdParam, mapSession, seedParam, sessionSearch } from '../src/game/match/session-url.js';
import { loadContentUnderTest } from '../test/real-content/helpers.js';
import { realMapScript, realMapWorldOfSession } from '../test/real-content/real-map-world.js';
import { boolEnv, intEnv, intListEnv, ruleEnv, stringEnv } from './knobs.js';
import { formatSeats } from './report/index.js';
import { SIM_ASSERTS } from './sim-asserts.js';

/**
 * The real-map world both map benchmarks measure, with the checkpoints that skip the build-out.
 * Hunting a late-game hotspot otherwise costs an hour of settlement growth per attempt: a run writes
 * the state after `skipTicks` to `checkpointPath` and at every tick in `checkpointMarks`, and a later
 * run restores one of those files and measures from there. A restored run is still the same world -
 * the checkpoint is a normal save, taken and reloaded through the `?map=` entry's own build and
 * restore, and the restore must reproduce the state hash the checkpoint was written with.
 *
 * The session is a browser `?map=` search, parsed by the entry's own URL adapter and built by the
 * entry's own world builder: `ON_BENCH_SESSION` names it whole, or the per-field knobs assemble
 * `?map=<id>&player=observer&computer=<seats>&seed=<n>&fog=classic`. The observer plays no seat, so
 * the only assistant grants are the AI seats' own. A checkpoint taken under
 * another map, seed, session or content is refused by name rather than measured: the numbers would
 * describe a world nobody asked for.
 */

/** Fog revealed as the original starts it: black, explored ground stays visible. A session that names
 *  its own fog keeps it. */
const BENCH_FOG: FogModeName = 'classic';

const DEFAULT_MAP_ID = 'magiczny_las';
/** `?computer=0,1,2,3,4,5`: every seat the default map offers a person, the session the real-content
 *  scenarios also use. */
const DEFAULT_AI_SEATS = 6;
/** Repeatable default: a benchmark compares runs of one world, so it never draws a seed. */
const DEFAULT_SEED = 7;
/** The opening ticks are atypical (crews bind, routes are cold) and JIT tiering has not settled - a
 *  restored checkpoint needs them too, since the restored world's code is cold again. */
const DEFAULT_WARMUP_TICKS = 200;

/** The knobs `ON_BENCH_SESSION` replaces; naming both is refused rather than merged. */
const SESSION_FIELD_KNOBS = [
  'ON_BENCH_MAP',
  'ON_BENCH_SEATS',
  'ON_BENCH_TRIBES',
  'ON_BENCH_SEED',
  'ON_BENCH_PROGRESSION',
  'ON_BENCH_NEEDS',
] as const;

const CHECKPOINT_EXT = '.checkpoint';
/** The `.t<tick>` a mark adds to the checkpoint stem, stripped again when a mark file is the base. */
const MARK_SUFFIX = /\.t\d+$/;

const { isValidPlayer } = components;

/** The session a benchmark builds and the canonical search a checkpoint and a report name it by. */
export interface BenchSession {
  readonly mapId: string;
  readonly game: GameSession;
  /** `sessionSearch` of `game` against the map's roster, without the `?` and decoded for reading, so
   *  two spellings of one session give one search. */
  readonly search: string;
}

export interface MapBenchWorldOptions {
  readonly session: BenchSession;
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
  readonly machineSeats: readonly number[];
  readonly source: 'built' | 'checkpoint';
  /** The tick the world stands at before warm-up, so the caller can name what it skipped. */
  readonly startTick: number;
  /** Call after every step the caller takes; writes the checkpoint of a mark the sim just reached. */
  readonly afterStep: () => void;
}

/** What the header alone cannot answer: the session the world was built with, the map size a restore
 *  would otherwise have to re-read the decoded map for, and the state hash a restore must reproduce. */
interface CheckpointStamp {
  /** {@link BenchSession.search}. */
  readonly search: string;
  readonly mapCells: { readonly width: number; readonly height: number };
  readonly stateHash: string;
}

type SessionStamp = Omit<CheckpointStamp, 'stateHash'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stampOf(session: unknown, path: string): CheckpointStamp {
  const fields = isRecord(session) ? session : {};
  const { search, mapCells, stateHash } = fields;
  if (
    typeof search !== 'string' ||
    !isRecord(mapCells) ||
    typeof mapCells.width !== 'number' ||
    typeof mapCells.height !== 'number' ||
    typeof stateHash !== 'string'
  ) {
    throw new Error(
      `${path} carries no benchmark stamp this tool reads (no session search); take the checkpoint again`,
    );
  }
  return { search, mapCells: { width: mapCells.width, height: mapCells.height }, stateHash };
}

function readCheckpoint(path: string): SaveGame {
  try {
    return parseSaveGame(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    throw new Error(`${path} is not a readable checkpoint: ${String(err)}`);
  }
}

/** The query of a full URL, or the text itself when it is a bare query; a `#` fragment is dropped. */
function queryOf(raw: string): string {
  const mark = raw.indexOf('?');
  const query = mark === -1 ? raw : raw.slice(mark + 1);
  return query.split('#')[0] ?? '';
}

/**
 * The session a browser would boot for `search`, against the roster of the map variant it names. Keys the `?map=`
 * entry does not read, such as `lang`, are ignored. Only the defaults differ from the browser's: fog
 * {@link BENCH_FOG} and seed {@link DEFAULT_SEED} when the search names none.
 */
export function benchSession(search: URLSearchParams): BenchSession {
  const params = new URLSearchParams(search);
  const mapId = mapIdParam(params);
  if (mapId === null || mapId === '') throw new Error(`the session '?${search}' names no map`);
  if (!params.has('fog')) params.set('fog', BENCH_FOG);
  if (seedParam(params) === null) {
    if (params.has('seed'))
      throw new Error(`the session names seed '${params.get('seed')}', which is no seed`);
    params.set('seed', `${DEFAULT_SEED}`);
  }
  const script = variantMapScript(
    realMapScript(mapId),
    mapSessionWorld(mapId, mapVariantParam(params, mapId)),
  );
  const roster = script === null ? [] : mapLobbySlots(script);
  const game = mapSession(params, roster);
  return { mapId, game, search: decodeURIComponent(sessionSearch(game, roster).toString()) };
}

function ascending(seats: readonly number[]): readonly number[] {
  return [...seats].sort((a, b) => a - b);
}

/** Every mismatch the numbers would silently absorb. `irVersion` covers regenerated content: the
 *  restore would reject it too, but only after the caller waited for the map to load. */
async function checkedStamp(save: SaveGame, path: string, session: BenchSession): Promise<CheckpointStamp> {
  const stamp = stampOf(save.header.session, path);
  const { merge } = await loadContentUnderTest();
  const irVersion = merge.content.manifest.version;
  const mismatch =
    save.header.mapId !== session.mapId
      ? `map '${save.header.mapId}', not '${session.mapId}'`
      : save.header.seed !== session.game.seed
        ? `seed ${save.header.seed}, not ${session.game.seed}`
        : stamp.search !== session.search
          ? `session '?${stamp.search}', not '?${session.search}'`
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
    writeCheckpoint(sim, path, options.session.mapId, session);
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
  const { session } = options;
  const machineSeats = ascending(machineSeatsOf(session.game));

  const path = options.checkpointPath;
  if (path !== null && existsSync(path)) {
    const save = readCheckpoint(path);
    const stamp = await checkedStamp(save, path, session);
    const { sim } = await realMapWorldOfSession(session.mapId, session.game, { save });
    const restoredHash = sim.hashState();
    if (restoredHash !== stamp.stateHash) {
      throw new Error(
        `${path} restores to state ${restoredHash}, not the ${stamp.stateHash} it was written at; ` +
          'the save round trip lost state, so a measurement from it would not describe the run',
      );
    }
    sim.setSyncDigest(options.syncDigest);
    checkMarksReachable(options, sim.tick, sim.tick + followingTicks);
    const sessionStamp: SessionStamp = { search: session.search, mapCells: stamp.mapCells };
    return {
      sim,
      mapCells: stamp.mapCells,
      machineSeats,
      source: 'checkpoint',
      startTick: sim.tick,
      afterStep: markWriter(sim, options, sessionStamp),
    };
  }

  const { sim, mapCells } = await realMapWorldOfSession(session.mapId, session.game);
  sim.setSyncDigest(options.syncDigest);
  checkMarksReachable(options, sim.tick, sim.tick + options.skipTicks + followingTicks);
  const sessionStamp: SessionStamp = { search: session.search, mapCells };
  const afterStep = markWriter(sim, options, sessionStamp);
  for (let i = 0; i < options.skipTicks; i++) {
    sim.step();
    afterStep();
  }
  if (path !== null) writeCheckpoint(sim, path, session.mapId, sessionStamp);
  return { sim, mapCells, machineSeats, source: 'built', startTick: sim.tick, afterStep };
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

/** The `?map=` search the per-field knobs assemble, with `?player=observer` watching every seat. */
function fieldSearch(): URLSearchParams {
  const params = new URLSearchParams({
    map: stringEnv('ON_BENCH_MAP', DEFAULT_MAP_ID),
    player: OBSERVER_SEAT,
  });
  const seats = seatsEnv('ON_BENCH_SEATS');
  if (seats.length > 0) params.set('computer', seats.join(','));
  const tribes = stringEnv('ON_BENCH_TRIBES', '');
  if (tribes !== '') params.set('tribes', tribes);
  params.set('seed', `${intEnv('ON_BENCH_SEED', DEFAULT_SEED, 0)}`);
  for (const [key, name] of [
    ['progression', 'ON_BENCH_PROGRESSION'],
    ['needs', 'ON_BENCH_NEEDS'],
  ] as const) {
    const rule = ruleEnv(name);
    if (rule !== null) params.set(key, rule ? 'on' : 'off');
  }
  return params;
}

/** `ON_BENCH_SESSION`, a browser URL or its query, or else the session the per-field knobs name. */
function sessionEnv(): BenchSession {
  const raw = stringEnv('ON_BENCH_SESSION', '');
  if (raw === '') return benchSession(fieldSearch());
  const conflicting = SESSION_FIELD_KNOBS.filter((name) => stringEnv(name, '') !== '');
  if (conflicting.length > 0) {
    throw new Error(
      `ON_BENCH_SESSION names the whole session, so ${conflicting.join(', ')} cannot change it; unset one side`,
    );
  }
  return benchSession(new URLSearchParams(queryOf(raw)));
}

/** The env knobs both real-map benchmarks share; `measuredTicks` differs per benchmark, so its
 *  default is the caller's. */
export function mapBenchKnobs(defaultMeasuredTicks: number): MapBenchKnobs {
  const checkpoint = stringEnv('ON_BENCH_CHECKPOINT', '');
  return {
    session: sessionEnv(),
    warmupTicks: intEnv('ON_BENCH_WARMUP', DEFAULT_WARMUP_TICKS, 0),
    measuredTicks: intEnv('ON_BENCH_TICKS', defaultMeasuredTicks, 1),
    syncDigest: boolEnv('ON_BENCH_SYNC_DIGEST'),
    checkpointPath: checkpoint === '' ? null : checkpoint,
    skipTicks: intEnv('ON_BENCH_SKIP', 0, 0),
    checkpointMarks: intListEnv('ON_BENCH_CHECKPOINTS', 1),
  };
}

/** The shared knobs as the report records them, so a stale report cannot be read as another run.
 *  The session is recorded as the `ON_BENCH_SESSION` that repeats it, whichever knobs named it. */
export function knobRecord(knobs: MapBenchKnobs): Readonly<Record<string, string>> {
  return {
    ON_BENCH_SESSION: knobs.session.search,
    ON_BENCH_TICKS: `${knobs.measuredTicks}`,
    ON_BENCH_WARMUP: `${knobs.warmupTicks}`,
    ON_BENCH_SYNC_DIGEST: knobs.syncDigest ? 'on' : 'off',
    ON_BENCH_SKIP: `${knobs.skipTicks}`,
    ON_BENCH_CHECKPOINT: knobs.checkpointPath ?? '',
    ON_BENCH_CHECKPOINTS: knobs.checkpointMarks.join(','),
    ON_BENCH_ASSERTS: SIM_ASSERTS ? 'on' : 'off',
  };
}

/** The lines a benchmark prints so its report cannot be read as a run of another session or one that
 *  started somewhere else. */
export function worldSourceLines(world: MapBenchWorld, knobs: MapBenchKnobs): readonly string[] {
  const checkpointPath = knobs.checkpointPath;
  const session = `session: ?${knobs.session.search}  (AI seats ${formatSeats(world.machineSeats)})`;
  const where = checkpointPath === null ? '' : ` ${checkpointPath}`;
  if (world.source === 'checkpoint') {
    return [session, `world: restored from checkpoint${where}, measuring from tick ${world.startTick}`];
  }
  const written = checkpointPath === null ? '' : `, checkpoint written to${where}`;
  return [session, `world: built and stepped to tick ${world.startTick} unmeasured${written}`];
}
