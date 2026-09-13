import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppServer,
  collectEngineHashes,
  collectNodeHashes,
  ENGINE_TARGETS,
  type EngineSession,
  type EngineTarget,
  EngineUnavailableError,
  type HashRun,
  openEngine,
  startAppServer,
} from './support/harness.js';
import { ENGINE_WORKLOADS, type EngineWorkload } from './support/workloads.js';

/** The manual `npm run test:engines` mode of docs/TESTING.md; skipped without `ON_ENGINES`. */

const SERVER_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 20 * 60_000;

/** `ON_ENGINES=all` (the runner's default) or a comma-separated subset of the engine ids. */
const requested = process.env.ON_ENGINES ?? '';

function selectedTargets(): readonly EngineTarget[] {
  if (requested === 'all') return ENGINE_TARGETS;
  const names = new Set(requested.split(',').map((id) => id.trim()));
  const known: ReadonlySet<string> = new Set(ENGINE_TARGETS.map((target) => target.id));
  for (const name of names) {
    if (!known.has(name)) throw new Error(`ON_ENGINES names no engine: ${name}`);
  }
  return ENGINE_TARGETS.filter((target) => names.has(target.id));
}

type EngineResult =
  | {
      readonly target: EngineTarget;
      readonly status: 'match';
      readonly startTick: number;
      readonly compared: number;
    }
  | {
      readonly target: EngineTarget;
      readonly status: 'diverged';
      readonly startTick: number;
      readonly detail: string;
    }
  /** The engine ran but produced no comparable sequence: a boot error, or a pause past the first grid tick. */
  | { readonly target: EngineTarget; readonly status: 'failed'; readonly detail: string }
  | { readonly target: EngineTarget; readonly status: 'unavailable'; readonly detail: string };

describe.runIf(requested !== '')('cross-engine determinism', () => {
  let server: AppServer | undefined;

  beforeAll(async () => {
    server = await startAppServer();
  }, SERVER_TIMEOUT_MS);
  afterAll(async () => {
    await server?.close();
  });

  for (const workload of ENGINE_WORKLOADS) {
    it.runIf(workload.available())(
      `${workload.id} hashes identically in every engine`,
      async () => {
        if (server === undefined) throw new Error('the app server did not start');
        const reference = await collectNodeHashes(workload);
        const results: EngineResult[] = [];
        for (const target of selectedTargets()) {
          results.push(await runEngine(target, workload, `${server.origin}/?${workload.query}`, reference));
        }
        report(workload, reference, results);
        const gateFailures = results.filter((r) => r.target.gate && r.status !== 'match');
        expect(gateFailures.map((r) => `${r.target.id}: ${r.status === 'match' ? '' : r.detail}`)).toEqual(
          [],
        );
      },
      TEST_TIMEOUT_MS,
    );
  }
});

/** A gate engine's error propagates with its stack; an informative engine's becomes its report line. */
async function runEngine(
  target: EngineTarget,
  workload: EngineWorkload,
  url: string,
  reference: HashRun,
): Promise<EngineResult> {
  let session: EngineSession;
  try {
    session = await openEngine(target.id, url);
  } catch (err) {
    if (target.gate) throw err;
    const status = err instanceof EngineUnavailableError ? 'unavailable' : 'failed';
    return { target, status, detail: String(err) };
  }
  try {
    return compare(target, reference, await collectEngineHashes(session, workload));
  } catch (err) {
    if (target.gate) throw err;
    return { target, status: 'failed', detail: String(err) };
  } finally {
    await session.close();
  }
}

function compare(target: EngineTarget, reference: HashRun, run: HashRun): EngineResult {
  const ticks = [...reference.hashes.keys()];
  const uncovered = ticks.filter((tick) => !run.hashes.has(tick));
  if (uncovered.length > 0) {
    return {
      target,
      status: 'failed',
      detail: `paused at tick ${run.startTick}, past the compared ticks ${uncovered.slice(0, 3).join(', ')}`,
    };
  }
  for (const tick of ticks) {
    const engineHash = run.hashes.get(tick);
    const nodeHash = reference.hashes.get(tick);
    if (engineHash !== nodeHash) {
      return {
        target,
        status: 'diverged',
        startTick: run.startTick,
        detail: `first divergence at tick ${tick}: engine ${engineHash}, node ${nodeHash}`,
      };
    }
  }
  return { target, status: 'match', startTick: run.startTick, compared: ticks.length };
}

/** WebKit and Firefox never fail the check, so their verdict has to be read here. */
function report(workload: EngineWorkload, reference: HashRun, results: readonly EngineResult[]): void {
  const ticks = [...reference.hashes.keys()];
  const range = ticks.length > 0 ? `${ticks[0]}..${ticks[ticks.length - 1]}` : 'none';
  const lines = results.map((result) => {
    const gate = result.target.gate ? 'gate' : 'informative';
    const suffix =
      result.status === 'match'
        ? `${result.compared} hashes, paused at tick ${result.startTick}`
        : result.detail;
    return `  ${result.target.id} (${gate}): ${result.status} - ${suffix}`;
  });
  console.log(
    [`${workload.id}: compared ticks ${range}, hash every ${workload.hashEvery}`, ...lines].join('\n'),
  );
}
