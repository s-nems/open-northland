// First, so the sim it is evaluated before reads the switch.
import './sim-asserts.js';
import {
  diffDigestInputs,
  exportSaveGame,
  parseSaveGame,
  type Simulation,
  SYNC_DOMAINS,
  type SyncDigest,
  type SyncDigestInputs,
  serializeSaveGame,
} from '@open-northland/sim';
import { realMapWorldOfSession } from '../test/content/real-map-world.js';
import { boolEnv, intEnv, intListEnv } from './knobs.js';
import { benchSession, mapBenchKnobs, mapBenchWorld, worldSourceLines } from './map-world.js';

/**
 * Restore parity - `npm run bench:parity`. A client joining a session restores a save and builds every
 * derived cache from it, so a cache whose answer depends on what it saw before the save desyncs it.
 * From the checkpoint the knobs name, one world runs `ON_BENCH_TICKS` ticks, recording its state hash
 * every {@link HASH_STRIDE} ticks and its per-tick sync digest, the fold of what each tick wrote that a
 * relay compares between clients; at `ON_BENCH_PARITY_POINTS` evenly spaced ticks, around the first
 * heavy link pass, AI decision and planner tick of the second half, and at the absolute ticks
 * `ON_BENCH_PARITY_AT` lists, its save is restored into a fresh world, which runs to the end and must
 * reproduce every hash and every digest. A digest that differs with the state hash intact means the
 * restored world wrote the same entities in another order, or other entities, than the continuous one
 * did, which the relay judges a desync all the same; the first such tick is diffed down to the
 * component and entity when it falls within {@link INPUT_WINDOW_TICKS} of the restore.
 * `ON_BENCH_PARITY_FRESH=on` instead builds the world twice from tick zero and compares the two runs:
 * plain determinism. Exits nonzero on the first divergence, naming its tick.
 */

/** Ticks between recorded hashes. */
const HASH_STRIDE = 50;
const DEFAULT_TICKS = 3000;
const DEFAULT_POINTS = 12;
/** A system tick over this many milliseconds marks a heavy tick worth restoring around. */
const HEAVY_SYSTEM_MS = 5;
/** Digest inputs are kept for this many ticks after each save point; a cold cache shows on the first
 *  ticks after the restore, and a whole run's inputs would not fit in memory. */
const INPUT_WINDOW_TICKS = 16;

interface Recording {
  readonly hashes: Map<number, string>;
  readonly digests: Map<number, string>;
  readonly inputs: Map<number, SyncDigestInputs>;
  readonly saves: Map<number, string>;
}

interface Divergence {
  readonly tick: number;
  readonly what: 'hash' | 'digest';
  readonly detail: string;
}

function digestKey(digest: SyncDigest): string {
  return SYNC_DOMAINS.map((domain) => digest.domains[domain]).join(',');
}

function differingDomains(recorded: string, digest: SyncDigest): string[] {
  const words = recorded.split(',').map(Number);
  return SYNC_DOMAINS.filter((domain, i) => words[i] !== digest.domains[domain]);
}

function stepRecording(
  sim: Simulation,
  ticks: number,
  points: ReadonlySet<number>,
  heavy: (tick: number, systems: Map<string, number>) => void,
): Recording {
  const hashes = new Map<number, string>();
  const digests = new Map<number, string>();
  const inputs = new Map<number, SyncDigestInputs>();
  const saves = new Map<number, string>();
  let tickSystems = new Map<string, number>();
  let lastPoint = Number.NEGATIVE_INFINITY;
  sim.setSyncDigest(true, { captureInputs: true });
  sim.setInstrument((name, run) => {
    const start = performance.now();
    run();
    tickSystems.set(name, (tickSystems.get(name) ?? 0) + performance.now() - start);
  });
  const end = sim.tick + ticks;
  while (sim.tick < end) {
    tickSystems = new Map();
    sim.step();
    heavy(sim.tick, tickSystems);
    const inWindow = sim.tick - lastPoint <= INPUT_WINDOW_TICKS;
    if (sim.tick % HASH_STRIDE === 0 || sim.tick === end || inWindow) hashes.set(sim.tick, sim.hashState());
    const digest = sim.syncDigest();
    if (digest !== null) digests.set(sim.tick, digestKey(digest));
    const tickInputs = sim.syncDigestInputs();
    if (tickInputs !== null && inWindow) inputs.set(sim.tick, tickInputs);
    if (points.has(sim.tick)) {
      saves.set(sim.tick, serializeSaveGame(exportSaveGame(sim)));
      lastPoint = sim.tick;
    }
  }
  sim.setInstrument(null);
  sim.setSyncDigest(false);
  return { hashes, digests, inputs, saves };
}

/** The first recorded hash or digest `sim` fails to reproduce as it steps to the last recorded tick. */
function firstDivergence(sim: Simulation, recorded: Recording): Divergence | null {
  const end = Math.max(...recorded.hashes.keys());
  sim.setSyncDigest(true, { captureInputs: true });
  try {
    while (sim.tick < end) {
      sim.step();
      const digest = sim.syncDigest();
      const expectedDigest = recorded.digests.get(sim.tick);
      if (digest !== null && expectedDigest !== undefined && digestKey(digest) !== expectedDigest) {
        return {
          tick: sim.tick,
          what: 'digest',
          detail: digestDetail(sim, recorded, expectedDigest, digest),
        };
      }
      const expected = recorded.hashes.get(sim.tick);
      if (expected !== undefined && sim.hashState() !== expected) {
        return { tick: sim.tick, what: 'hash', detail: 'state hash' };
      }
    }
    return null;
  } finally {
    sim.setSyncDigest(false);
  }
}

function digestDetail(sim: Simulation, recorded: Recording, expected: string, digest: SyncDigest): string {
  const domains = differingDomains(expected, digest).join('+');
  const hash = recorded.hashes.get(sim.tick);
  const state =
    hash === undefined
      ? 'state hash not kept'
      : hash === sim.hashState()
        ? 'state identical'
        : 'state differs';
  const continuous = recorded.inputs.get(sim.tick);
  const restored = sim.syncDigestInputs();
  if (continuous === undefined || restored === null) return `domains ${domains}, ${state}, inputs not kept`;
  const difference = diffDigestInputs(continuous, restored);
  return `domains ${domains}, ${state}, first difference (a = continuous, b = restored) ${JSON.stringify(difference)}`;
}

async function main(): Promise<void> {
  const knobs = mapBenchKnobs(DEFAULT_TICKS);
  const ticks = intEnv('ON_BENCH_TICKS', DEFAULT_TICKS, HASH_STRIDE);
  const session = benchSession(knobs);

  if (boolEnv('ON_BENCH_PARITY_FRESH')) {
    const first = await realMapWorldOfSession(knobs.mapId, session);
    const recorded = stepRecording(first.sim, ticks, new Set(), () => {});
    const second = await realMapWorldOfSession(knobs.mapId, session);
    const diverged = firstDivergence(second.sim, recorded);
    console.log(
      diverged === null
        ? `determinism: two fresh worlds agree on ${recorded.hashes.size} hashes and ${recorded.digests.size} digests over ${ticks} ticks`
        : `determinism: DIVERGED by tick ${diverged.tick} (${diverged.what}: ${diverged.detail})`,
    );
    if (diverged !== null) process.exitCode = 1;
    return;
  }

  const world = await mapBenchWorld({ ...knobs, checkpointMarks: [] }, ticks);
  for (const line of worldSourceLines(world, knobs)) console.log(line);
  const start = world.sim.tick;
  const count = intEnv('ON_BENCH_PARITY_POINTS', DEFAULT_POINTS, 1);
  const points = new Set<number>();
  for (let i = 1; i <= count; i++) points.add(start + Math.floor((i * ticks) / (count + 1)));
  for (const tick of intListEnv('ON_BENCH_PARITY_AT', start + 1)) points.add(tick);
  // Heavy ticks of the second half, restored at and just before: a link pass, an AI decision, a planner
  // burst. The marks are chosen while stepping, so only ticks after their discovery can be saved.
  const half = start + ticks / 2;
  const wanted = new Map<string, number>();
  const extra = new Set<number>();
  const recorded = stepRecording(world.sim, ticks, points, (tick, systems) => {
    if (tick < half) return;
    for (const name of ['signpostLinks', 'aiPlayer', 'planner']) {
      if (wanted.has(name) || (systems.get(name) ?? 0) < HEAVY_SYSTEM_MS) continue;
      wanted.set(name, tick);
      // This tick's save is taken below once it is added; the next restores after the heavy tick.
      points.add(tick);
      points.add(tick + 1);
      extra.add(tick);
      extra.add(tick + 1);
    }
  });
  console.log(
    `continuous run: ${recorded.hashes.size} hashes, ${recorded.digests.size} digests, ${recorded.saves.size} saves`,
  );
  console.log(`heavy ticks restored around: ${JSON.stringify(Object.fromEntries(wanted))}`);

  let failures = 0;
  for (const [tick, text] of [...recorded.saves].sort((a, b) => a[0] - b[0])) {
    const save = parseSaveGame(JSON.parse(text));
    const { sim } = await realMapWorldOfSession(knobs.mapId, session, { save });
    const diverged = firstDivergence(sim, recorded);
    const label = extra.has(tick) ? ' (heavy-tick restore)' : '';
    console.log(
      diverged === null
        ? `restore at ${tick}${label}: matches through tick ${sim.tick}`
        : `restore at ${tick}${label}: DIVERGED at tick ${diverged.tick} (${diverged.what}: ${diverged.detail})`,
    );
    if (diverged !== null) failures++;
  }
  console.log(failures === 0 ? 'restore parity: clean' : `restore parity: ${failures} divergent restore(s)`);
  if (failures > 0) process.exitCode = 1;
}

await main();
