// First, so the sim it is evaluated before reads the switch.
import './sim-asserts.js';
import { exportSaveGame, parseSaveGame, type Simulation, serializeSaveGame } from '@open-northland/sim';
import { realMapWorldOfSession } from '../test/content/real-map-world.js';
import { boolEnv, intEnv, intListEnv } from './knobs.js';
import { benchSession, mapBenchKnobs, mapBenchWorld, worldSourceLines } from './map-world.js';

/**
 * Restore parity - `npm run bench:parity`. A client joining a session restores a save and builds every
 * derived cache from it, so a cache whose answer depends on what it saw before the save desyncs it.
 * From the checkpoint the knobs name, one world runs `ON_BENCH_TICKS` ticks, recording its state hash
 * every {@link HASH_STRIDE} ticks; at `ON_BENCH_PARITY_POINTS` evenly spaced ticks, around the first
 * heavy link pass, AI decision and planner tick of the second half, and at the absolute ticks
 * `ON_BENCH_PARITY_AT` lists, its save is restored into a fresh world, which runs to the end and must
 * reproduce every hash.
 * `ON_BENCH_PARITY_FRESH=on` instead builds the world twice from tick zero and compares the two runs:
 * plain determinism. Exits nonzero on the first divergence, naming its tick.
 */

/** Ticks between recorded hashes. */
const HASH_STRIDE = 50;
const DEFAULT_TICKS = 3000;
const DEFAULT_POINTS = 12;
/** A system tick over this many milliseconds marks a heavy tick worth restoring around. */
const HEAVY_SYSTEM_MS = 5;

interface Recording {
  readonly hashes: Map<number, string>;
  readonly saves: Map<number, string>;
}

function stepRecording(
  sim: Simulation,
  ticks: number,
  points: ReadonlySet<number>,
  heavy: (tick: number, systems: Map<string, number>) => void,
): Recording {
  const hashes = new Map<number, string>();
  const saves = new Map<number, string>();
  let tickSystems = new Map<string, number>();
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
    if (sim.tick % HASH_STRIDE === 0 || sim.tick === end) hashes.set(sim.tick, sim.hashState());
    if (points.has(sim.tick)) saves.set(sim.tick, serializeSaveGame(exportSaveGame(sim)));
  }
  sim.setInstrument(null);
  return { hashes, saves };
}

/** The first recorded hash `sim` fails to reproduce as it steps to the last recorded tick, or null. */
function firstDivergence(sim: Simulation, hashes: ReadonlyMap<number, string>): number | null {
  const end = Math.max(...hashes.keys());
  while (sim.tick < end) {
    sim.step();
    const expected = hashes.get(sim.tick);
    if (expected !== undefined && sim.hashState() !== expected) return sim.tick;
  }
  return null;
}

async function main(): Promise<void> {
  const knobs = mapBenchKnobs(DEFAULT_TICKS);
  const ticks = intEnv('ON_BENCH_TICKS', DEFAULT_TICKS, HASH_STRIDE);
  const session = benchSession(knobs);

  if (boolEnv('ON_BENCH_PARITY_FRESH')) {
    const first = await realMapWorldOfSession(knobs.mapId, session);
    const recorded = stepRecording(first.sim, ticks, new Set(), () => {});
    const second = await realMapWorldOfSession(knobs.mapId, session);
    const diverged = firstDivergence(second.sim, recorded.hashes);
    console.log(
      diverged === null
        ? `determinism: two fresh worlds agree on ${recorded.hashes.size} hashes over ${ticks} ticks`
        : `determinism: DIVERGED by tick ${diverged}`,
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
  console.log(`continuous run: ${recorded.hashes.size} hashes, ${recorded.saves.size} saves`);
  console.log(`heavy ticks restored around: ${JSON.stringify(Object.fromEntries(wanted))}`);

  let failures = 0;
  for (const [tick, text] of [...recorded.saves].sort((a, b) => a[0] - b[0])) {
    const save = parseSaveGame(JSON.parse(text));
    const { sim } = await realMapWorldOfSession(knobs.mapId, session, { save });
    const diverged = firstDivergence(sim, recorded.hashes);
    const label = extra.has(tick) ? ' (heavy-tick restore)' : '';
    console.log(
      diverged === null
        ? `restore at ${tick}${label}: matches through tick ${sim.tick}`
        : `restore at ${tick}${label}: DIVERGED at tick ${diverged}`,
    );
    if (diverged !== null) failures++;
  }
  console.log(failures === 0 ? 'restore parity: clean' : `restore parity: ${failures} divergent restore(s)`);
  if (failures > 0) process.exitCode = 1;
}

await main();
