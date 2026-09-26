import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import type { WorkerSessionOptions } from '../../../src/session/worker/protocol.js';
import type { StallReports } from '../../../src/session/worker/stall-watch.js';
import {
  startWorkerSession,
  type WorkerSession,
  type WorkerSessionTimings,
} from '../../../src/session/worker/worker-session.js';
import { nodeWorkerPort } from './node-ports.js';
import type { TestWorldBoot } from './test-world.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The test worker bundled into one Node module: `worker_threads` runs plain JavaScript and resolves
 * the workspace packages to their built output, where the tests read the sources.
 */
export async function bundleTestWorker(): Promise<{ readonly path: string; dispose(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'on-session-worker-'));
  const path = join(dir, 'node-sim-worker.mjs');
  await build({
    entryPoints: [resolve(here, 'node-sim-worker.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    conditions: ['source'],
    outfile: path,
    logLevel: 'silent',
  });
  return { path, dispose: () => rm(dir, { recursive: true, force: true }) };
}

export const SILENT_STALL_REPORTS: StallReports = { stalled: () => undefined, recovered: () => undefined };

export const DEFAULT_TEST_OPTIONS: WorkerSessionOptions = {
  speed: 1,
  paused: true,
  fogSeat: null,
  diagnostics: false,
  pauseOnSubMission: false,
};

export function startTestSession(
  workerPath: string,
  boot: TestWorldBoot,
  options: Partial<WorkerSessionOptions> = {},
  reports: StallReports = SILENT_STALL_REPORTS,
  timings: WorkerSessionTimings = {},
): Promise<WorkerSession<null>> {
  const port = nodeWorkerPort(new Worker(workerPath));
  return startWorkerSession<TestWorldBoot, null>(
    port,
    boot,
    { ...DEFAULT_TEST_OPTIONS, ...options },
    reports,
    timings,
  );
}

/** A display frame's interval while the tests stand in for the frame loop. */
const FRAME_MS = 4;

/**
 * Stand in for the frame loop: advance the session's driver every few milliseconds until `done`
 * holds after a frame. `onTick` is the per-tick callback the frame loop would pass.
 */
export async function pumpUntil(
  session: WorkerSession<unknown>,
  done: () => boolean,
  onTick?: () => void,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    session.driver.advance(FRAME_MS, onTick);
    if (done()) return;
    if (performance.now() > deadline) throw new Error('the session did not reach the awaited state in time');
    await new Promise((resolveFrame) => setTimeout(resolveFrame, FRAME_MS));
  }
}

/** Await `promise` while the frame loop stand-in keeps delivering. */
export async function pumpWhile<T>(session: WorkerSession<unknown>, promise: Promise<T>): Promise<T> {
  let settled = false;
  const guarded = promise.finally(() => {
    settled = true;
  });
  // Handled here so a rejection while pumping is not reported as unhandled; the await below rethrows.
  guarded.catch(() => undefined);
  await pumpUntil(session, () => settled);
  return guarded;
}
