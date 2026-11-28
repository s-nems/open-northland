/**
 * The lab's big-world builder: a map with its claimable seats played by the computer, every one of them
 * unless a count is given, and nobody else, run on the plain sim for a number of ticks, then written as the canonical save a relayed
 * room shares, so `--save` can start a lab room from a developed world.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createSavedSessionMetadata } from '@open-northland/lockstep';
import { base64ToBytes, encodeSnapshot } from '@open-northland/net-client';
import { components, exportSaveGame, SnapshotMirror, serializeSaveGame } from '@open-northland/sim';
import { buildRelayedMapWorld } from '../../src/entries/map/world-inputs.js';
import { calibrationMs, loadPerCpu } from '../environment.js';
import { type SeatCensus, seatCensus } from './client-probe.js';
import { type ComputerDifficulty, integerArg } from './config.js';
import { labSeats, observerSession, worldBoot } from './world.js';

const DIFFICULTIES: readonly string[] = components.COMPUTER_DIFFICULTIES;
const BYTES_PER_MB = 1024 * 1024;
/** Ticks run between two progress lines. */
const PROGRESS_EVERY_TICKS = 2000;

export interface SaveWorldConfig {
  readonly mapId: string;
  /** Computer seats, the first claimable ones; null takes every claimable seat. */
  readonly computers: number | null;
  readonly difficulty: ComputerDifficulty;
  readonly ticks: number;
  readonly seed: number;
  /** The gzipped save's path. */
  readonly out: string;
}

const DEFAULT_SAVE_WORLD = {
  mapId: 'magiczny_las',
  computers: null,
  difficulty: 'hard',
  ticks: 40_000,
  seed: 7,
} as const satisfies Omit<SaveWorldConfig, 'out'>;

/** Ignored by Git: the save is derived from the decoded content and is never committed. */
function defaultOut(config: Omit<SaveWorldConfig, 'out'>): string {
  return `bench-out/net-lab/${config.mapId}-${config.difficulty}-t${config.ticks}.save.gz`;
}

export const SAVE_WORLD_USAGE = `usage: npm run bench:net-lab -- build-save [flags]
  --map <id>          decoded map (default ${DEFAULT_SAVE_WORLD.mapId})
  --computers <n>     computer seats, the first claimable ones (default: every claimable seat)
  --difficulty <lvl>  easy | medium | hard, for every computer seat (default ${DEFAULT_SAVE_WORLD.difficulty})
  --ticks <n>         ticks to run before saving (default ${DEFAULT_SAVE_WORLD.ticks})
  --seed <n>          world seed (default ${DEFAULT_SAVE_WORLD.seed})
  --out <path>        the gzipped save (default bench-out/net-lab/<map>-<difficulty>-t<ticks>.save.gz)`;

export function parseSaveWorldArgs(argv: readonly string[]): SaveWorldConfig {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || !flag.startsWith('--'))
      throw new Error(`expected a --flag, got '${flag}'\n${SAVE_WORLD_USAGE}`);
    if (value === undefined) throw new Error(`${flag} needs a value\n${SAVE_WORLD_USAGE}`);
    values.set(flag, value);
  }
  const take = (flag: string): string | undefined => {
    const value = values.get(flag);
    values.delete(flag);
    return value;
  };
  const difficulty = take('--difficulty') ?? DEFAULT_SAVE_WORLD.difficulty;
  if (!DIFFICULTIES.includes(difficulty))
    throw new Error(`--difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  const computers = take('--computers');
  const ticks = take('--ticks');
  const seed = take('--seed');
  const config = {
    mapId: take('--map') ?? DEFAULT_SAVE_WORLD.mapId,
    computers:
      computers === undefined ? DEFAULT_SAVE_WORLD.computers : integerArg('--computers', computers, 1),
    difficulty: difficulty as ComputerDifficulty,
    ticks: ticks === undefined ? DEFAULT_SAVE_WORLD.ticks : integerArg('--ticks', ticks, 1),
    seed: seed === undefined ? DEFAULT_SAVE_WORLD.seed : integerArg('--seed', seed, 0),
  };
  const out = take('--out') ?? defaultOut(config);
  if (values.size > 0) throw new Error(`unknown flag ${[...values.keys()].join(', ')}\n${SAVE_WORLD_USAGE}`);
  return { ...config, out };
}

export interface SaveWorldReport {
  readonly config: SaveWorldConfig;
  readonly computers: readonly number[];
  readonly tick: number;
  readonly stateHash: string;
  readonly entities: number;
  /** What each computer seat holds at the save's tick. */
  readonly census: readonly ({ readonly player: number } & SeatCensus)[];
  /** The canonical save JSON, and its gzip: the file and the decoded snapshot payload. */
  readonly saveBytes: number;
  readonly gzipBytes: number;
  readonly wall: {
    readonly buildSeconds: number;
    readonly runSeconds: number;
    readonly saveSeconds: number;
    readonly peakRssMb: number;
    readonly loadPerCpu: number | null;
    readonly calibration: { readonly beforeMs: number; readonly afterMs: number };
  };
}

export interface SaveWorldHooks {
  readonly progress?: (line: string) => void;
}

/** Build the all-computer world, run it, and write its gzipped canonical save to `config.out`. */
export async function buildSaveWorld(
  config: SaveWorldConfig,
  hooks: SaveWorldHooks = {},
): Promise<SaveWorldReport> {
  const calibrationBeforeMs = calibrationMs();
  let worstLoad = loadPerCpu() ?? 0;
  const { setup, seats } = labSeats({
    mapId: config.mapId,
    humans: 0,
    computers: config.computers,
    difficulty: config.difficulty,
  });
  const session = observerSession(config.mapId, config.seed, 1, setup);
  const boot = await worldBoot(config.mapId);
  const buildStart = performance.now();
  const { sim } = buildRelayedMapWorld(boot(session), null, null);
  const buildSeconds = (performance.now() - buildStart) / 1000;
  const rssMb = (): number => Math.round(process.memoryUsage.rss() / BYTES_PER_MB);
  let peakRssMb = rssMb();
  const runStart = performance.now();
  while (sim.tick < config.ticks) {
    sim.run(Math.min(PROGRESS_EVERY_TICKS, config.ticks - sim.tick));
    peakRssMb = Math.max(peakRssMb, rssMb());
    worstLoad = Math.max(worstLoad, loadPerCpu() ?? 0);
    const wall = ((performance.now() - runStart) / 1000).toFixed(1);
    hooks.progress?.(
      `tick ${sim.tick}  entities ${sim.world.entityCount}  wall ${wall} s  rss ${peakRssMb} MB`,
    );
  }
  const runSeconds = (performance.now() - runStart) / 1000;
  const stream = sim.snapshotDeltas();
  const mirror = new SnapshotMirror();
  const delta = stream.next();
  if (delta !== null) mirror.apply(delta);
  stream.close();
  const snapshot = mirror.snapshot();
  const census = seats.computer.map((player) => ({ player, ...seatCensus(snapshot, player) }));
  const saveStart = performance.now();
  // The roster a relayed save records: the descriptor's seats, nobody named, since no human plays.
  const metadata = createSavedSessionMetadata(
    session,
    session.seats.map((seat) => ({ player: seat.player, nick: null })),
  );
  const save = exportSaveGame(sim, { mapId: config.mapId, session: metadata, savedAt: null });
  const saveBytes = Buffer.byteLength(serializeSaveGame(save));
  // The snapshot codec's own gzip, so the file's base64 is a snapshot blob's payload as it stands.
  const gzip = base64ToBytes(await encodeSnapshot(save));
  const path = resolve(config.out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzip);
  const saveSeconds = (performance.now() - saveStart) / 1000;
  return {
    config: { ...config, out: path },
    computers: seats.computer,
    tick: sim.tick,
    stateHash: sim.hashState(),
    entities: sim.world.entityCount,
    census,
    saveBytes,
    gzipBytes: gzip.byteLength,
    wall: {
      buildSeconds,
      runSeconds,
      saveSeconds,
      peakRssMb: Math.max(peakRssMb, rssMb()),
      loadPerCpu: worstLoad === 0 ? null : worstLoad,
      calibration: { beforeMs: calibrationBeforeMs, afterMs: calibrationMs() },
    },
  };
}

export function formatSaveWorld(report: SaveWorldReport): string {
  const { config, wall } = report;
  const mb = (bytes: number): string => (bytes / BYTES_PER_MB).toFixed(2);
  const msPerTick = (wall.runSeconds * 1000) / report.tick;
  return [
    `build-save ${config.mapId}: computers ${report.computers.join(',')} (${config.difficulty}), seed ${config.seed}`,
    `tick ${report.tick}, ${report.entities} entities, state hash ${report.stateHash}`,
    `seats (people/buildings): ${report.census.map((row) => `${row.player}: ${row.people}/${row.buildings}`).join(', ')}`,
    `save ${mb(report.saveBytes)} MB JSON, ${mb(report.gzipBytes)} MB gzip -> ${config.out}`,
    `wall: build ${wall.buildSeconds.toFixed(1)} s, run ${wall.runSeconds.toFixed(1)} s ` +
      `(${msPerTick.toFixed(2)} ms/tick), save ${wall.saveSeconds.toFixed(1)} s; peak rss ${wall.peakRssMb} MB; ` +
      `load/cpu ${wall.loadPerCpu?.toFixed(2) ?? '-'}; calibration ${wall.calibration.beforeMs.toFixed(1)} -> ` +
      `${wall.calibration.afterMs.toFixed(1)} ms`,
  ].join('\n');
}
