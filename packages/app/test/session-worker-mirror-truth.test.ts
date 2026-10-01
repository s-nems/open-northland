import { MessageChannel } from 'node:worker_threads';
import {
  type EntitySnapshot,
  entitiesWith,
  entityDeltas,
  packSnapshotDelta,
  type SnapshotDelta,
} from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { diag } from '../src/diag/log.js';
import { INVARIANT_CHECK_EVERY_TICKS } from '../src/diag/session.js';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { servedOverLoopback } from '../src/session/worker/loopback.js';
import type { FromWorker, WorkerSessionOptions } from '../src/session/worker/protocol.js';
import { type HostedBuild, serveSession } from '../src/session/worker/serve.js';
import { startWorkerSession, type WorkerSession } from '../src/session/worker/worker-session.js';
import { nodeParentPort } from './support/session-worker/node-ports.js';

/**
 * A `debug=diag` worker session checks the mirror it draws from against the worker's world: a delta
 * that arrives missing a write is logged on the batch that carries it, and an index that drifted from
 * the entities is logged on the next invariant tick. An honest session logs neither.
 */

const SPEED = 8;
const TURN_MS = 10;
const RUN_TIMEOUT_MS = 30_000;
const SILENT_STALL_REPORTS = { stalled: () => undefined, recovered: () => undefined };
const OPTIONS: WorkerSessionOptions = {
  speed: SPEED,
  paused: false,
  fogSeat: null,
  diagnostics: true,
  pauseOnSubMission: false,
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sandbox(_boot: null, options: WorkerSessionOptions): HostedBuild<null> {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  return servedOverLoopback({ sim: createSceneSim(scene), extras: null }, options);
}

/** The delta with the first component of its first non-empty entry left out, as a stream that lost
 *  one write would carry it. */
function withLostWrite(delta: SnapshotDelta): SnapshotDelta | null {
  const entries = entityDeltas(delta);
  const at = entries.findIndex((entry) => Object.keys(entry.components).length > 0);
  const entry = entries[at];
  if (entry === undefined) return null;
  const [lost] = Object.keys(entry.components);
  const kept = Object.fromEntries(Object.entries(entry.components).filter(([name]) => name !== lost));
  const touched = entries.map((each, i) => (i === at ? { ...entry, components: kept } : each));
  return packSnapshotDelta({ ...delta, touched });
}

let session: WorkerSession<null> | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
});

/** A diag session over a message channel; `tamper` may rewrite a batch's delta on its way in. */
async function diagSession(tamper: (delta: SnapshotDelta) => SnapshotDelta | null = () => null) {
  const channel = new MessageChannel();
  serveSession(nodeParentPort(channel.port1), sandbox);
  const inner = nodeParentPort(channel.port2);
  const started = await startWorkerSession<null, null>(
    {
      ...inner,
      close: () => {
        channel.port1.close();
        channel.port2.close();
      },
      listen: (receive) =>
        inner.listen((message, receiveMs) => {
          const landed = message as FromWorker<null>;
          if (landed.kind !== 'ticks') return receive(message, receiveMs);
          const delta = tamper(landed.batch.delta) ?? landed.batch.delta;
          receive({ ...landed, batch: { ...landed.batch, delta } }, receiveMs);
        }),
    },
    null,
    OPTIONS,
    SILENT_STALL_REPORTS,
  );
  session = started;
  return started;
}

async function runPast(running: WorkerSession<null>, tick: number): Promise<void> {
  const deadline = performance.now() + RUN_TIMEOUT_MS;
  while (running.host.tick <= tick) {
    if (performance.now() > deadline) throw new Error(`the session never passed tick ${tick}`);
    running.driver.advance(0);
    await sleep(TURN_MS);
  }
}

/** Entries logged from `from` on. Take it once the session started: in one thread the worker's ready
 *  message hands the runtime the whole shared ring again, under a `worker:` prefix. */
function mirrorErrorsSince(from: number): string[] {
  return diag
    .entries()
    .slice(from)
    .filter((entry) => entry.channel === 'mirror')
    .map((entry) => entry.message);
}

describe('a diag worker session checks its mirror', () => {
  it('logs nothing while the drawn world is the worker’s', async () => {
    const running = await diagSession();
    const from = diag.entries().length;
    entitiesWith(running.host.snapshot(), 'Settler');
    await runPast(running, INVARIANT_CHECK_EVERY_TICKS * 2);
    expect(mirrorErrorsSince(from)).toEqual([]);
  });

  it('logs the batch that lost a write once, however long the mismatch lasts', async () => {
    let tamperedTick: number | null = null;
    const running = await diagSession((delta) => {
      if (tamperedTick !== null || delta.tick < 10) return null;
      const tampered = withLostWrite(delta);
      if (tampered !== null) tamperedTick = delta.tick;
      return tampered;
    });
    const from = diag.entries().length;
    await runPast(running, 60);
    expect(mirrorErrorsSince(from)).toEqual([
      `the drawn world parted from the worker's at tick ${tamperedTick}`,
    ]);
  });

  it('logs an index that drifted from the entities on the next invariant tick', async () => {
    const running = await diagSession();
    const from = diag.entries().length;
    const settlers = entitiesWith(running.host.snapshot(), 'Settler') as EntitySnapshot[];
    settlers.push({ id: Number.MAX_SAFE_INTEGER, components: {} });
    await runPast(running, INVARIANT_CHECK_EVERY_TICKS);
    const errors = mirrorErrorsSince(from);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^snapshot indexes disagree with the drawn world at tick \d+$/);
  });
});
