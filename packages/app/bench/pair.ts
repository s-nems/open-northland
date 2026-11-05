import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadPerCpu } from './environment.js';
import { intEnv, numberEnv, stringEnv } from './knobs.js';
import { formatPairs, type PairRepeat, readReport, summarizePairs } from './report/index.js';
import { benchOutDir } from './store.js';

/**
 * Two checkouts' built `bench:map` programs run at the same time - `npm run bench:pair`. Sequential runs
 * on a shared machine compare two different machines; running side by side cancels the drift, and
 * alternating which side launches first cancels the launch order. `scripts/bench/pair.mjs` is the argv
 * wrapper; every other bench knob in the environment reaches both sides unchanged.
 */

const PROGRAM = 'packages/app/dist-tsc/bench/map-tick.js';
const DEFAULT_REPEATS = 3;
/** How long the load gate waits before running anyway; a shared machine may never fall quiet. */
const DEFAULT_LOAD_WAIT_S = 600;
const LOAD_POLL_MS = 10_000;
const MS_PER_S = 1000;
/** Knobs the wrapper owns per side, or that would make the two sides write the same files. */
const PER_SIDE_KNOBS = ['ON_BENCH_JSON', 'ON_BENCH_CHECKPOINTS'] as const;

type Side = 'a' | 'b';

function checkout(name: string): string {
  const path = stringEnv(name, '');
  if (path === '') throw new Error(`${name} is not set`);
  if (!existsSync(join(path, PROGRAM))) {
    throw new Error(`${path} has no built ${PROGRAM}; run 'npx tsc --build' in that checkout first`);
  }
  return path;
}

/** A missing checkpoint would make both sides build and write it at once, so it must exist already. */
function checkedEnvironment(): NodeJS.ProcessEnv {
  for (const knob of PER_SIDE_KNOBS) {
    if (stringEnv(knob, '') !== '') throw new Error(`bench:pair sets no ${knob}; unset it`);
  }
  const checkpoint = stringEnv('ON_BENCH_CHECKPOINT', '');
  if (checkpoint !== '' && !existsSync(checkpoint)) {
    throw new Error(
      `ON_BENCH_CHECKPOINT ${checkpoint} does not exist; write it with npm run bench:map first`,
    );
  }
  const content = stringEnv('ON_CONTENT_DIR', '');
  if (content === '' || !existsSync(content)) throw new Error(`ON_CONTENT_DIR '${content}' does not exist`);
  return process.env;
}

/** Waits until the 1-minute load per cpu is below `maxLoad`, or `waitS` has passed; returns the load. */
async function loadGate(maxLoad: number | null, waitS: number): Promise<number | null> {
  const deadline = performance.now() + waitS * MS_PER_S;
  let load = loadPerCpu();
  while (maxLoad !== null && load !== null && load >= maxLoad) {
    if (performance.now() >= deadline) {
      console.log(`pair: load ${load.toFixed(2)}/cpu still over ${maxLoad} after ${waitS} s; running anyway`);
      break;
    }
    await sleep(LOAD_POLL_MS);
    load = loadPerCpu();
  }
  return load;
}

/** One side's running bench: `done` settles when it exits, `stop` ends it early. */
interface Run {
  readonly done: Promise<void>;
  stop(): void;
}

function launch(path: string, env: NodeJS.ProcessEnv, report: string, log: string): Run {
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, [PROGRAM], {
    cwd: path,
    env: { ...env, ON_BENCH_JSON: report },
    stdio: ['ignore', fd, fd],
  });
  const done = new Promise<void>((resolve, fail) => {
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      closeSync(fd);
      if (code === 0) resolve();
      else fail(new Error(`${path} exited with ${signal ?? code}; see ${log}`));
    });
  });
  const stop = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  return { done, stop };
}

/** Both sides of one repeat; when one fails the other is stopped before the failure is reported, so no
 *  orphan keeps loading the machine. */
async function runSides(runs: readonly Run[]): Promise<void> {
  try {
    await Promise.all(runs.map((run) => run.done));
  } catch (err) {
    for (const run of runs) run.stop();
    await Promise.allSettled(runs.map((run) => run.done));
    throw err;
  }
}

/** A fresh directory: reports of an earlier pair under the same name must not be mixed in. */
function outputDir(): string {
  const name = stringEnv('ON_BENCH_PAIR_NAME', new Date().toISOString().replace(/[:.]/g, '-'));
  const dir = join(benchOutDir(), 'pair', name);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`${dir} already holds a pair; choose another ON_BENCH_PAIR_NAME`);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function main(): Promise<void> {
  const paths: Record<Side, string> = { a: checkout('ON_BENCH_PAIR_A'), b: checkout('ON_BENCH_PAIR_B') };
  const env = checkedEnvironment();
  const repeats = intEnv('ON_BENCH_PAIR_REPEATS', DEFAULT_REPEATS, 1);
  // 0 turns the gate off, as unset does: no load is below it.
  const loadKnob = numberEnv('ON_BENCH_PAIR_LOAD');
  const maxLoad = loadKnob === null || loadKnob === 0 ? null : loadKnob;
  const waitS = intEnv('ON_BENCH_PAIR_LOAD_WAIT', DEFAULT_LOAD_WAIT_S, 0);
  const dir = outputDir();
  console.log(`pair: A ${paths.a}\npair: B ${paths.b}\npair: reports under ${dir}`);

  const results: PairRepeat[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const load = await loadGate(maxLoad, waitS);
    const order: readonly Side[] = repeat % 2 === 1 ? ['a', 'b'] : ['b', 'a'];
    console.log(
      `pair: repeat ${repeat}/${repeats}, ${order.join(' then ').toUpperCase()}, load ${load?.toFixed(2) ?? 'n/a'}/cpu`,
    );
    const file = (side: Side, ext: string): string => join(dir, `r${repeat}-${side}${ext}`);
    await runSides(order.map((side) => launch(paths[side], env, file(side, '.json'), file(side, '.log'))));
    const read = (side: Side) =>
      readReport(JSON.parse(readFileSync(file(side, '.json'), 'utf8')), file(side, '.json'));
    results.push({ a: read('a'), b: read('b') });
  }
  console.log(`\n${formatPairs(summarizePairs(results))}\n`);
}

await main().catch((err: unknown) => {
  console.error(`bench:pair: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
